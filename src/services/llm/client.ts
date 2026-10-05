/**
 * LLM 流式客户端 —— OpenAI 兼容 `/chat/completions` + SSE 解析 + 双层超时 + 错误分类。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.14.4（网络层）。
 *
 * ★ 本模块是**唯一**允许发 AI 请求的地方，且对外只暴露 `streamChat()` 一个出口。
 *   - 所有失败都变成 `LlmError`，**从不 throw 裸 Error**，调用方只需看 `code`；
 *   - 所有失败都是"可降级"的，UI 侧只需 `catch` → 回退离线评分；
 *   - 🔴 `apiKey` 只出现在 `Authorization` 头里，**绝不**进入 message / 日志 / 错误对象任何字段。
 */

import {
  LLM_FIRST_TOKEN_TIMEOUT_MS,
  LLM_MAX_RETRY,
  LLM_MAX_TOKENS,
  LLM_RETRY_BACKOFF_MS,
  LLM_TEMPERATURE,
  LLM_TOTAL_TIMEOUT_MS,
} from './constants';
import { LlmError } from './types';
import type { LlmErrorCode, StreamChatOptions } from './types';

/** SSE 行前缀 */
const SSE_DATA_PREFIX = 'data:';
/** OpenAI 流结束标记 */
const SSE_DONE = '[DONE]';

/** `AbortSignal.any` 在部分环境（旧 Safari / jsdom）不存在，这里做能力探测 */
interface AbortSignalAnyCapable {
  any?: (signals: AbortSignal[]) => AbortSignal;
}

/** 合并后的信号 + 清理函数 */
interface CombinedSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

/** 合并多个信号：任一 abort 即整体 abort。优先 `AbortSignal.any`，不支持时手动转发 */
function combineSignals(signals: AbortSignal[]): CombinedSignal {
  const anyFn = (AbortSignal as unknown as AbortSignalAnyCapable).any;
  if (typeof anyFn === 'function') {
    return { signal: anyFn.call(AbortSignal, signals), cleanup: () => undefined };
  }

  const controller = new AbortController();
  const pairs = signals.map((signal) => {
    const handler = (): void => {
      controller.abort();
    };
    signal.addEventListener('abort', handler, { once: true });
    return { signal, handler };
  });
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const pair of pairs) {
        pair.signal.removeEventListener('abort', pair.handler);
      }
    },
  };
}

/** 退避等待（仅重试路径使用，正常路径零延迟） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 去掉结尾斜杠，避免拼出 `//chat/completions` */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** HTTP 状态码 → 错误分类 */
function classifyStatus(status: number): LlmErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limit';
  // 5xx 与其余非 2xx（400/404/422…）一律按"服务端异常"处理：UI 文案一致，且不会误判成 Key 问题
  return 'server';
}

/**
 * 非 `LlmError` 的异常 → 错误分类。
 *
 * 判定顺序：先看是不是"我们自己 abort 的"（超时 / 外部取消），再看是不是网络层 reject。
 */
function classifyUnknown(
  error: unknown,
  combinedSignal: AbortSignal,
  externalSignal: AbortSignal | undefined,
  timedOut: boolean,
): LlmError {
  const isAbortError = error instanceof Error && error.name === 'AbortError';
  if (isAbortError || combinedSignal.aborted) {
    const externallyAborted = Boolean(externalSignal?.aborted) && !timedOut;
    return new LlmError(externallyAborted ? 'aborted' : 'timeout');
  }
  // fetch reject：离线 / DNS 失败 / CORS 被拦。🔴 不读取 error.message，避免把任何请求细节带出去
  return new LlmError('network');
}

/** 取 SSE 一行的 `data:` 载荷；不是 data 行或载荷为空时返回 null */
function readDataPayload(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(SSE_DATA_PREFIX)) return null;
  const payload = trimmed.slice(SSE_DATA_PREFIX.length).trim();
  return payload.length > 0 ? payload : null;
}

/** 从 delta 块里取文本内容；结构不符时返回空串（不抛错，跳过即可） */
function extractDeltaContent(json: unknown): string {
  if (typeof json !== 'object' || json === null) return '';
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as { delta?: unknown } | undefined;
  const delta = first?.delta;
  if (typeof delta !== 'object' || delta === null) return '';
  const content = (delta as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

/**
 * 读取 SSE 流：逐块累积 → 逐行解析 → 取 `choices[0].delta.content`。
 *
 * @param body 响应体流
 * @param onDelta 每个文本块的回调（供 UI 做"在动了"的预览）
 * @param onFirstToken 收到第一个非空 delta 时调用（用于解除首字节超时）
 * @returns 累积的完整文本
 */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (chunk: string) => void,
  onFirstToken: () => void,
): Promise<string> {
  const reader = body.getReader();
  // ★ stream: true —— 防止一个多字节 UTF-8 字符被网络分块切成两半后出现乱码
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let sawDataLine = false;
  let gotFirstToken = false;
  let finished = false;
  let streamDone = false;

  const handleLine = (line: string): void => {
    const payload = readDataPayload(line);
    if (payload === null) return;
    sawDataLine = true;
    if (payload === SSE_DONE) {
      finished = true;
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      // SSE 帧不是合法 JSON：协议被破坏，无法继续可靠解析
      throw new LlmError('parse');
    }
    const chunk = extractDeltaContent(json);
    if (chunk.length === 0) return;
    if (!gotFirstToken) {
      gotFirstToken = true;
      onFirstToken();
    }
    text += chunk;
    onDelta(chunk);
  };

  while (!finished) {
    const result = await reader.read();
    if (result.done) {
      streamDone = true;
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split('\n');
    // 最后一段可能是不完整的行，留到下一块再处理
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      handleLine(line);
    }
  }

  // 流结束时冲刷解码器残留字节，并处理最后一行（SSE 末行未必带换行）
  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    handleLine(buffer);
  }

  if (finished && !streamDone) {
    // 提前收到 [DONE]：主动关闭流，避免连接悬挂
    try {
      await reader.cancel();
    } catch {
      /* 流已关闭 / 不支持 cancel，忽略 */
    }
  }

  // ★ 一个 data 行都没见过，或全程没有任何内容 —— 这是"200 但没法解析"，绝不当作空结果返回
  if (!sawDataLine || text.length === 0) {
    throw new LlmError('parse');
  }
  return text;
}

/** 单次请求（不含重试） */
async function runOnce(opts: StreamChatOptions, onDelta: (chunk: string) => void): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? LLM_TOTAL_TIMEOUT_MS;
  const firstTokenTimeoutMs = opts.firstTokenTimeoutMs ?? LLM_FIRST_TOKEN_TIMEOUT_MS;

  const timeoutController = new AbortController();
  const signals: AbortSignal[] = [timeoutController.signal];
  if (opts.signal) signals.push(opts.signal);
  const combined = combineSignals(signals);

  // ★ 双层超时：首字节 / 整体，任一触发即 abort
  let timedOut = false;
  const overallTimer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);
  const firstTokenTimer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, firstTokenTimeoutMs);

  try {
    const response = await fetch(`${normalizeBaseUrl(opts.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        temperature: opts.temperature ?? LLM_TEMPERATURE,
        max_tokens: opts.maxTokens ?? LLM_MAX_TOKENS,
      }),
      signal: combined.signal,
    });

    if (!response.ok) {
      throw new LlmError(classifyStatus(response.status));
    }
    if (!response.body) {
      // 200 但没有响应体（非流式环境下常见）→ 无法解析
      throw new LlmError('parse');
    }

    return await readSse(response.body, onDelta, () => {
      clearTimeout(firstTokenTimer);
    });
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw classifyUnknown(error, combined.signal, opts.signal, timedOut);
  } finally {
    clearTimeout(overallTimer);
    clearTimeout(firstTokenTimer);
    combined.cleanup();
  }
}

/**
 * 发起一次流式对话，返回累积的完整文本。
 *
 * - 失败一律 `throw LlmError`，调用方按 `code` 取 `LLM_ERROR_MESSAGE` 展示；
 * - 仅 `retryable`（`rate_limit` / `timeout` / `network` / `server`）重试，最多 `LLM_MAX_RETRY` 次；
 * - 🔴 **已向调用方吐过内容就不再重试**：流式预览已经在屏幕上了，重发一次会让用户看到
 *   同一段话重复两遍（"partialpartial"）。此时宁可原样抛错让 UI 回退离线，也不能给出脏预览；
 * - 🔴 **不吞错、不返回空串**：拿不到内容就抛错，让调用方回退离线评分。
 *
 * @param opts 请求参数（含 baseUrl / model / apiKey / messages）
 * @param onDelta 逐块回调，用于流式预览（★ 这段文本绝不能当评分展示）
 * @returns 累积的完整文本（供 `parseLlmReview()` 解析）
 */
export async function streamChat(
  opts: StreamChatOptions,
  onDelta: (chunk: string) => void,
): Promise<string> {
  let lastError: LlmError = new LlmError('network');
  // 本次调用是否已经向调用方吐过内容（一旦为 true 就永久禁止重试）
  let emitted = false;
  const trackedDelta = (chunk: string): void => {
    emitted = true;
    onDelta(chunk);
  };

  for (let attempt = 0; attempt <= LLM_MAX_RETRY; attempt += 1) {
    if (attempt > 0) {
      await sleep(LLM_RETRY_BACKOFF_MS);
    }
    try {
      return await runOnce(opts, trackedDelta);
    } catch (error) {
      const llmError = error instanceof LlmError ? error : new LlmError('network');
      lastError = llmError;
      if (!llmError.retryable) throw llmError;
      if (emitted) throw llmError;
    }
  }
  throw lastError;
}
