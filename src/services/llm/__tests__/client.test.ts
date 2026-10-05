/**
 * `client.ts` 单测 —— 用 `vi.stubGlobal('fetch')` 造七类响应，断言错误分类与重试策略。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.14.4（网络层）+ §5.14.11（DoD）。
 *
 * ★ 测试纪律：
 *   - 超时用**真实超时**（把 `timeoutMs` 传 1），不用 fake timers —— 假的定时器会让
 *     "首字节 / 整体"两层谁先触发变得不可信；
 *   - 每条错误断言都同时断言 `retryable`，因为"要不要重试"直接决定用户等待时长。
 */

import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLM_MAX_TOKENS, LLM_TEMPERATURE, LLM_RETRY_BACKOFF_MS } from '../constants';
import { streamChat } from '../client';
import { LlmError, LLM_ERROR_MESSAGE } from '../types';
import type { StreamChatOptions } from '../types';

/* jsdom 不保证提供 TextEncoder / TextDecoder，这里按需补齐（仅测试环境需要） */
const globals = globalThis as unknown as Record<string, unknown>;
if (typeof globals.TextEncoder === 'undefined') globals.TextEncoder = NodeTextEncoder;
if (typeof globals.TextDecoder === 'undefined') globals.TextDecoder = NodeTextDecoder;

const encoder = new TextEncoder();

/** 测试用的假 Key（★ 所有"密钥不泄露"断言都靠它） */
const FAKE_KEY = 'sk-test-SECRET-KEY-0001';

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** 造一条 SSE 文本块 */
function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

/** 造一个 Response 形状的假响应 */
function makeResponse(status: number, body: unknown = null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
  } as unknown as Response;
}

/** 造一个按序吐出若干字节块、然后结束的流 */
function streamBody(chunks: Uint8Array[]): unknown {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (index < chunks.length) {
          const value = chunks[index] as Uint8Array;
          index += 1;
          return { done: false, value };
        }
        return { done: true, value: undefined };
      },
      cancel: async () => undefined,
      releaseLock: () => undefined,
    }),
  };
}

/** 造一个永不吐数据的流（用于首字节超时）；abort 时按浏览器行为 reject */
function hangingBody(signal: AbortSignal | null | undefined): unknown {
  return {
    getReader: () => ({
      read: () =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
      cancel: async () => undefined,
      releaseLock: () => undefined,
    }),
  };
}

/** 先吐一块（解除首字节超时），随后永久挂起（等整体超时） */
function streamThenHang(first: Uint8Array, signal: AbortSignal | null | undefined): unknown {
  let index = 0;
  return {
    getReader: () => ({
      read: () => {
        if (index === 0) {
          index += 1;
          return Promise.resolve({ done: false, value: first });
        }
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        });
      },
      cancel: async () => undefined,
      releaseLock: () => undefined,
    }),
  };
}

/** 与浏览器同形同名的 AbortError */
function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

type FetchHandler = (init: RequestInit, callIndex: number) => Response | Promise<Response>;

/** 替换全局 fetch；已在外部 abort 时按浏览器行为直接 reject */
function stubFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  const mock = vi.fn(async (_input: unknown, init: RequestInit = {}) => {
    if (init.signal?.aborted) throw abortError();
    const response = handler(init, callIndex);
    callIndex += 1;
    return response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function opts(overrides: Partial<StreamChatOptions> = {}): StreamChatOptions {
  return {
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
    apiKey: FAKE_KEY,
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ],
    ...overrides,
  };
}

/** 捕获 `streamChat` 抛出的错误并断言它是 `LlmError` */
async function captureError(promise: Promise<string>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmError);
    return error as LlmError;
  }
  throw new Error('预期 streamChat 抛错，但实际 resolve 了');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamChat · 成功路径', () => {
  it('★ onDelta 被逐块回调，且返回值等于累积全文', async () => {
    stubFetch(() => makeResponse(200, streamBody([bytes(sseChunk('With')), bytes(sseChunk(' the')), bytes(sseChunk(' development.'))])));
    const deltas: string[] = [];
    const text = await streamChat(opts(), (chunk) => {
      deltas.push(chunk);
    });
    expect(deltas).toEqual(['With', ' the', ' development.']);
    expect(text).toBe('With the development.');
    expect(text).toBe(deltas.join(''));
  });

  it('收到 [DONE] 后结束；后续块不再累积', async () => {
    const chunks = [
      bytes(`${sseChunk('ok')}data: [DONE]\n\n`),
      bytes(sseChunk('SHOULD-NOT-APPEAR')),
    ];
    stubFetch(() => makeResponse(200, streamBody(chunks)));
    const text = await streamChat(opts(), () => undefined);
    expect(text).toBe('ok');
  });

  it('★ 多字节 UTF-8 被切成两半也不会乱码（TextDecoder stream 模式）', async () => {
    const raw = bytes(sseChunk('经济发展'));
    const cut = 1; // 把一个汉字的 UTF-8 字节拦腰截断
    const head = raw.slice(0, raw.length - cut);
    const tail = raw.slice(raw.length - cut);
    stubFetch(() => makeResponse(200, streamBody([head, tail])));
    const text = await streamChat(opts(), () => undefined);
    expect(text).toBe('经济发展');
  });

  it('请求形状：POST {baseUrl}/chat/completions + Bearer + stream:true', async () => {
    const fetchMock = stubFetch(() => makeResponse(200, streamBody([bytes(sseChunk('ok'))])));
    await streamChat(opts(), () => undefined);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/chat/completions');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(LLM_TEMPERATURE);
    expect(body.max_tokens).toBe(LLM_MAX_TOKENS);
    expect(body.messages).toHaveLength(2);
  });

  it('baseUrl 结尾斜杠被归一化，不会拼出 //chat/completions', async () => {
    const fetchMock = stubFetch(() => makeResponse(200, streamBody([bytes(sseChunk('ok'))])));
    await streamChat(opts({ baseUrl: 'https://api.example.com/v1/' }), () => undefined);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/chat/completions');
  });
});

describe('streamChat · 错误分类', () => {
  it('401 → auth，不重试（只发一次请求）', async () => {
    const fetchMock = stubFetch(() => makeResponse(401));
    const error = await captureError(streamChat(opts(), () => undefined));
    expect(error.code).toBe('auth');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(LLM_ERROR_MESSAGE.auth);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('403 → auth，不重试', async () => {
    const fetchMock = stubFetch(() => makeResponse(403));
    const error = await captureError(streamChat(opts(), () => undefined));
    expect(error.code).toBe('auth');
    expect(error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 → rate_limit，可重试（共发两次请求）', async () => {
    const fetchMock = stubFetch(() => makeResponse(429));
    const error = await captureError(streamChat(opts(), () => undefined));
    expect(error.code).toBe('rate_limit');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe(LLM_ERROR_MESSAGE.rate_limit);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('★ 429 重试一次后成功：fetch 被调用两次，返回累积文本', async () => {
    const fetchMock = stubFetch((_init, callIndex) => {
      if (callIndex === 0) return makeResponse(429);
      return makeResponse(200, streamBody([bytes(sseChunk('retry-ok'))]));
    });
    const deltas: string[] = [];
    const text = await streamChat(opts(), (chunk) => {
      deltas.push(chunk);
    });
    expect(text).toBe('retry-ok');
    expect(deltas).toEqual(['retry-ok']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('5xx → server，可重试', async () => {
    const fetchMock = stubFetch(() => makeResponse(503));
    const error = await captureError(streamChat(opts(), () => undefined));
    expect(error.code).toBe('server');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe(LLM_ERROR_MESSAGE.server);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetch reject（离线 / CORS）→ network，可重试', async () => {
    const fetchMock = stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const error = await captureError(streamChat(opts(), () => undefined));
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe(LLM_ERROR_MESSAGE.network);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('★ 首字节超时：firstTokenTimeoutMs=1 永不吐数据 → timeout', async () => {
    stubFetch((init) => makeResponse(200, hangingBody(init.signal ?? null)));
    const error = await captureError(
      streamChat(opts({ firstTokenTimeoutMs: 1, timeoutMs: 5_000 }), () => undefined),
    );
    expect(error.code).toBe('timeout');
    expect(error.message).toBe(LLM_ERROR_MESSAGE.timeout);
  });

  it('★ 整体超时：已收到首字节后挂起，timeoutMs=1 → timeout', async () => {
    stubFetch((init) => makeResponse(200, streamThenHang(bytes(sseChunk('partial')), init.signal ?? null)));
    const deltas: string[] = [];
    const error = await captureError(
      streamChat(opts({ firstTokenTimeoutMs: 5_000, timeoutMs: 1 }), (chunk) => {
        deltas.push(chunk);
      }),
    );
    expect(error.code).toBe('timeout');
    expect(deltas).toEqual(['partial']);
  });

  it('200 但脏输入（非 SSE 的 JSON）→ parse，不重试', async () => {
    const fetchMock = stubFetch(() => makeResponse(200, streamBody([bytes('{"score": 11}')])));
    const error = await captureError(streamChat(opts(), () => undefined));
    expect(error.code).toBe('parse');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(LLM_ERROR_MESSAGE.parse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('SSE 帧不是合法 JSON → parse，不重试', async () => {
    const fetchMock = stubFetch(() => makeResponse(200, streamBody([bytes('data: {oops}\n\n')])));
    const error = await captureError(streamChat(opts(), () => undefined));
    expect(error.code).toBe('parse');
    expect(error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('200 但全程无内容（只有 [DONE]）→ parse，不重试', async () => {
    const fetchMock = stubFetch(() => makeResponse(200, streamBody([bytes('data: [DONE]\n\n')])));
    const error = await captureError(streamChat(opts(), () => undefined));
    expect(error.code).toBe('parse');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('streamChat · 取消', () => {
  it('★ 外部 signal 已 abort → aborted，不重试，文案为空串', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = stubFetch(() => makeResponse(200, streamBody([bytes(sseChunk('ok'))])));
    const error = await captureError(streamChat(opts({ signal: controller.signal }), () => undefined));
    expect(error.code).toBe('aborted');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('');
    expect(LLM_ERROR_MESSAGE.aborted).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('★ 流式中途被外部 abort → aborted，不重试', async () => {
    const controller = new AbortController();
    stubFetch((init) =>
      makeResponse(
        200,
        streamThenHang(bytes(sseChunk('partial')), init.signal ?? null),
      ),
    );
    const error = await captureError(
      streamChat(opts({ signal: controller.signal, firstTokenTimeoutMs: 5_000, timeoutMs: 5_000 }), () => {
        controller.abort();
      }),
    );
    expect(error.code).toBe('aborted');
    expect(error.retryable).toBe(false);
  });
});

describe('streamChat · 安全与常量', () => {
  it('🔴 错误对象的任何字段都不含 apiKey', async () => {
    stubFetch(() => makeResponse(401));
    const error = await captureError(streamChat(opts(), () => undefined));
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      stack: error.stack ?? '',
    });
    expect(serialized).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain('sk-');
  });

  it('🔴 七条错误文案均不含 apiKey，且逐字等于约定文案', async () => {
    expect(LLM_ERROR_MESSAGE).toEqual({
      auth: 'AI Key 无效或没有该模型权限，已用离线评分',
      rate_limit: 'AI 请求过于频繁或额度用尽，已用离线评分',
      timeout: 'AI 响应超时，已用离线评分',
      network: '无法连接 AI 服务（网络或跨域限制），已用离线评分',
      server: 'AI 服务暂时不可用，已用离线评分',
      parse: 'AI 返回内容无法解析，已用离线评分',
      aborted: '',
    });
    for (const message of Object.values(LLM_ERROR_MESSAGE)) {
      expect(message).not.toContain(FAKE_KEY);
    }
  });

  it('重试前会退避 LLM_RETRY_BACKOFF_MS（观测到 ≥ 该间隔）', async () => {
    const timestamps: number[] = [];
    stubFetch(() => {
      timestamps.push(Date.now());
      return makeResponse(500);
    });
    await captureError(streamChat(opts(), () => undefined));
    expect(timestamps).toHaveLength(2);
    expect((timestamps[1] as number) - (timestamps[0] as number)).toBeGreaterThanOrEqual(
      LLM_RETRY_BACKOFF_MS - 50,
    );
  });
});
