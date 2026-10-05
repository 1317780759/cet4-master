/**
 * 翻译评分器注册表 —— **AI 的唯一接线点**（docs/04b §5.14.8 / V-17）。
 *
 * ★ 为什么要有这一层：UI 只允许 `import type { TranslationScorer }`，
 *   绝不允许 import `scoreOffline` / `createLlmScorer` 这类实现模块。
 *   这样"用不用 AI"就完全收敛到一个函数里，回滚只需把 `AI_ENABLED` 置 false。
 *
 * 🔴 铁律 A2（零后端）与 G9（AI 不阻塞）：
 *   - `AI_ENABLED = false` 时，本模块**不发任何网络请求**，恒返回离线评分器；
 *   - 明文 API Key 只在 `buildLlmScorer()` 里从 `secrets` 表读出并**按需注入**，
 *     绝不进入 `UserSettings`、日志或任何 state。
 */

import { createOfflineScorer } from '@/domain/translation/scorer';
import type { TranslationScorer } from '@/domain/translation/types';
import type { AiConfig } from '@/domain/settings/types';
import type { Cet4Database } from '@/data/db/db';
import { getSecret } from '@/data/repos/secretRepo';
import { createLlmScorer, type LlmTranslationScorer } from '@/services/llm/llmScorer';

/**
 * ★ 全局开关。回滚 AI 的**唯一**动作：把它置回 false。
 *   置 false 后整站零网络请求、离线评分完全不受影响。
 */
export const AI_ENABLED = true;

/** 密钥在 `secrets` 表里的固定 id（与 `AiConfig.keyId` 对应） */
export const API_KEY_SECRET_ID = 'llm.apiKey';

/** 配置是否完整到可以发请求（开关开着但三件套没填齐时，UI 应把开关回落为 false） */
export function isAiConfigComplete(config: AiConfig | undefined): config is AiConfig {
  if (!config) return false;
  return config.enabled && config.baseUrl.trim().length > 0 && config.model.trim().length > 0;
}

/** 🔴 Base URL 必须是 https —— http 明文一律拒绝，防止 API Key 走明文传输 */
export function isSecureBaseUrl(baseUrl: string): boolean {
  return baseUrl.trim().toLowerCase().startsWith('https://');
}

/**
 * 恒定返回离线评分器。
 *
 * ★ 存在的理由：`DualScoreCard` 要求**离线卡永远渲染**（AI 是增强不是依赖），
 *   因此结果页需要"不管 AI 开没开都能拿到的那一份评分"。
 *   有了这个出口，UI 就永远不必 import `createOfflineScorer` 实现模块，
 *   "用哪个评分器"的决定权仍完整留在这个注册表里。
 */
export function getOfflineScorer(): TranslationScorer {
  return createOfflineScorer();
}

/**
 * 依据设置取出当前该用的评分器。
 *
 * @param settings 用户设置（只读 `aiConfig`；**不**从中读明文 Key）
 * @param instance Dexie 实例（读 `secrets` 表用）
 * @returns 离线评分器，或配置完整时的 AI 评分器
 */
export async function getTranslationScorer(
  settings: { aiConfig?: AiConfig },
  instance?: Cet4Database,
): Promise<TranslationScorer> {
  if (!AI_ENABLED) return createOfflineScorer();
  const config = settings.aiConfig;
  if (!isAiConfigComplete(config) || !isSecureBaseUrl(config.baseUrl)) {
    return createOfflineScorer();
  }

  // 🔴 只有真正要用 AI 时才读密钥；关闭状态下 secrets 表完全不被触碰
  const keyId = config.keyId ?? API_KEY_SECRET_ID;
  const apiKey = await getSecret(keyId, instance);
  if (!apiKey || apiKey.trim().length === 0) {
    return createOfflineScorer();
  }

  return createLlmScorer({
    baseUrl: config.baseUrl.trim(),
    model: config.model.trim(),
    apiKey: apiKey.trim(),
    timeoutMs: config.timeoutMs,
  });
}

/**
 * 同 `getTranslationScorer`，但把结果收窄成 AI 版（供 `DualScoreCard` 拿纠错明细）。
 *
 * 返回 `null` 表示"这次不该有 AI 卡"——UI 据此**不渲染** AI 卡，而不是渲染一个空的。
 */
export async function getLlmScorer(
  settings: { aiConfig?: AiConfig },
  instance?: Cet4Database,
): Promise<LlmTranslationScorer | null> {
  const scorer = await getTranslationScorer(settings, instance);
  return scorer.id === 'llm' ? (scorer as LlmTranslationScorer) : null;
}
