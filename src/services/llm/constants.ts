/**
 * LLM 网络层常量。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.14.4（网络层）与 §5.14.10 文件清单第 17 项。
 *
 * ★ 这些常量**只服务于 AI 批改**：AI 是增强不是依赖，任何一项超时都会静默回退离线评分，
 *   因此这里的数值取的是"最坏情况下用户还能接受"的下限，而不是"跑满模型能力"的上限。
 */

/** 首字节超时（ms）：发出请求后多久没收到第一个 delta 就判定超时 */
export const LLM_FIRST_TOKEN_TIMEOUT_MS = 15_000;

/** 整体超时（ms）：整个流式请求（含首字节）的硬上限 */
export const LLM_TOTAL_TIMEOUT_MS = 60_000;

/** 单次批改的 max_tokens：够写完 5 条纠错 + 亮点 + 建议，且不会让响应拖太久 */
export const LLM_MAX_TOKENS = 1024;

/** temperature：批改要稳，不要创造力 */
export const LLM_TEMPERATURE = 0.2;

/** 最多重试次数（不含首次）。仅 `retryable` 错误才重试 */
export const LLM_MAX_RETRY = 1;

/** 重试退避（ms）：第一次失败后等待这么久再试第二次 */
export const LLM_RETRY_BACKOFF_MS = 1_500;
