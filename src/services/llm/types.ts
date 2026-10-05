/**
 * LLM 网络层类型契约 + 错误分类。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.14.4（网络层）。
 *
 * ★ 铁律 G9：AI 永不阻塞主流程 —— 任何 AI 失败都只是**降级**，不是错误弹窗。
 *   因此 `LLM_ERROR_MESSAGE` 的每一条文案都已经自带"已用离线评分"的安抚信息，
 *   UI 直接取用即可，不需要（也不应该）再拼接任何句子。
 */

/** 错误分类：七种，覆盖"认证 / 限流 / 超时 / 网络 / 服务端 / 解析 / 取消" */
export type LlmErrorCode =
  /** 401 / 403：Key 无效或没有该模型权限 */
  | 'auth'
  /** 429：限流或额度用尽 */
  | 'rate_limit'
  /** 首字节超时 / 整体超时 */
  | 'timeout'
  /** fetch reject（离线 / DNS / CORS） */
  | 'network'
  /** 5xx */
  | 'server'
  /** 200 但内容无法解析 */
  | 'parse'
  /** 用户主动取消 */
  | 'aborted';

/** 错误的对外形状（UI 只需要这三个字段） */
export interface LlmErrorShape {
  code: LlmErrorCode;
  /** 用户可见中文文案；`aborted` 为空串（UI 见空串即不提示） */
  message: string;
  /** 是否值得重试（由 code 唯一决定，调用方不要自己判断） */
  retryable: boolean;
}

/**
 * 各 code 是否重试。
 *
 * 来源：§5.14.4 错误分类表的"重试"列 —— auth ❌ / rate_limit ✅ / timeout ✅ /
 * network ✅ / server ✅ / parse ❌ / aborted ❌。
 */
const LLM_RETRYABLE: Record<LlmErrorCode, boolean> = {
  auth: false,
  rate_limit: true,
  timeout: true,
  network: true,
  server: true,
  parse: false,
  aborted: false,
};

/**
 * 用户可见文案（★ 逐字来自 §5.14.4 错误分类表，改动前必须同步文档）。
 *
 * `aborted` 故意为空串：用户自己取消的，不需要任何解释，UI 见空串直接回到离线结果。
 */
export const LLM_ERROR_MESSAGE: Record<LlmErrorCode, string> = {
  auth: 'AI Key 无效或没有该模型权限，已用离线评分',
  rate_limit: 'AI 请求过于频繁或额度用尽，已用离线评分',
  timeout: 'AI 响应超时，已用离线评分',
  network: '无法连接 AI 服务（网络或跨域限制），已用离线评分',
  server: 'AI 服务暂时不可用，已用离线评分',
  parse: 'AI 返回内容无法解析，已用离线评分',
  aborted: '',
};

/**
 * LLM 错误对象。
 *
 * 🔴 安全约束：错误对象里**只**保留 `code` / `message` / `retryable` 三个字段，
 *   绝不允许把 `apiKey`、请求体、响应体挂进来（`message` 也恒为固定文案，不含任何运行时细节）。
 */
export class LlmError extends Error implements LlmErrorShape {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;

  constructor(code: LlmErrorCode, message?: string) {
    super(message ?? LLM_ERROR_MESSAGE[code]);
    this.name = 'LlmError';
    this.code = code;
    this.retryable = LLM_RETRYABLE[code];
  }
}

/** 一次对话消息（OpenAI 兼容格式的最小子集） */
export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

/** `streamChat()` 的入参 */
export interface StreamChatOptions {
  /** OpenAI 兼容端点，如 `https://api.example.com/v1`（结尾斜杠会被自动去掉） */
  baseUrl: string;
  model: string;
  apiKey: string;
  messages: LlmMessage[];
  /** 外部取消信号（页面卸载 / 路由切换时 abort） */
  signal?: AbortSignal;
  /** 整体超时，默认 `LLM_TOTAL_TIMEOUT_MS` */
  timeoutMs?: number;
  /** 首字节超时，默认 `LLM_FIRST_TOKEN_TIMEOUT_MS` */
  firstTokenTimeoutMs?: number;
  /** 默认 `LLM_TEMPERATURE` */
  temperature?: number;
  /** 默认 `LLM_MAX_TOKENS` */
  maxTokens?: number;
}
