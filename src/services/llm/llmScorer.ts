/**
 * AI 评分器 —— 把 `streamChat()` + `parseLlmReview()` 包装成一个 `TranslationScorer`。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.14.7（双评分并列） / V-17。
 *
 * ★ 关键设计：`TranslationScorer.score()` 的返回类型 `ScoreResult` 里**没有**纠错明细，
 *   而 AI 的价值恰恰在"逐句纠错"。因此这里额外暴露一个更宽的 `review()` 方法：
 *   - `score()`  —— 满足 `TranslationScorer` 契约（分数 + 档位 + 得分点命中），AI 卡与离线卡同构；
 *   - `review()` —— 额外带回 `LlmReview`（纠错 / 亮点 / 建议），供 `DualScoreCard` 渲染。
 *   这样 UI 只依赖 `TranslationScorer` 接口，二期开关 AI 时离线卡零改动。
 *
 * ★ 铁律 G9：任何失败都 `throw LlmError`，由 registry 捕获后回退离线，**不把异常漏给 UI**。
 */

import { buildSystemPrompt, buildUserPrompt } from '@/domain/llm/prompt';
import { parseLlmReview, type LlmReview } from '@/domain/llm/parse';
import { createOfflineScorer, toScore } from '@/domain/translation/scorer';
import type { Score, ScoreRequest, ScoreResult, TranslationScorer } from '@/domain/translation/types';
import { LlmError } from '@/services/llm/types';
import type { StreamChatOptions } from '@/services/llm/types';
import { streamChat } from './client';

/** AI 批改的来源标签（UI 直接显示） */
export const LLM_SCORER_LABEL = 'AI 批改';

/**
 * AI 批改的入参 = `ScoreRequest` + 提示词必需的原文与参考译文。
 *
 * ★ 刻意**不**把 `zh` / `reference` 塞进 `src/domain/translation/types.ts` 的 `ScoreRequest`：
 *   那是离线评分的纯契约（只有文本 + 得分点），领域层不得为网络批改的需求让步。
 *   这里在服务层扩展，`TranslationScorer` 基类契约保持原样。
 */
export interface LlmReviewRequest extends ScoreRequest {
  /** 中文题干 */
  zh: string;
  /** 参考译文（仅供模型理解考点，不是唯一标准答案） */
  reference: string;
}

/** `review()` 的返回值 = `ScoreResult` + AI 独有的纠错明细 */
export interface LlmScoreResult extends ScoreResult {
  review: LlmReview;
  /** AI 给的 0–15 原始分（离线卡没有此字段） */
  aiScore: number;
}

/** AI 版 `TranslationScorer`：在基类之上多一个 `review()` */
export interface LlmTranslationScorer extends TranslationScorer {
  readonly id: 'llm';
  /** 带回纠错明细的完整批改结果 */
  review(req: LlmReviewRequest, onDelta?: (chunk: string) => void): Promise<LlmScoreResult>;
}

/** 构造 `streamChat` 所需的请求参数 */
function buildMessages(req: LlmReviewRequest): StreamChatOptions['messages'] {
  return [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: buildUserPrompt({
        zh: req.zh,
        reference: req.reference,
        myText: req.text,
        keyPoints: req.keyPoints.map((kp) => ({ head: kp.head, zh: kp.zh })),
      }),
    },
  ];
}

/** 兜底：把 0–15 分映射为 0..1 比例 */
function ratioFromAiScore(aiScore: number): number {
  return Math.round((aiScore / 15) * 10000) / 10000;
}

/**
 * AI 评分结果 → `LlmScoreResult`。
 *
 * ★ 得分点命中（`points`）仍然复用**离线**匹配结果：AI 不按 keyPoints 逐条打标，
 *   硬要它逐条判断反而不可靠。离线匹配是确定性的、已被 113 个用例覆盖，
 *   拿它当"哪些点命中了"的展示依据，AI 只负责给**分数与纠错** —— 各司其职。
 */
function toLlmResult(review: LlmReview, offline: ScoreResult): LlmScoreResult {
  const ratio = ratioFromAiScore(review.score);
  return {
    total: offline.total,
    hit: offline.hit,
    ratio,
    points: offline.points,
    band: review.band,
    scoredBy: LLM_SCORER_LABEL,
    review,
    aiScore: review.score,
  };
}

/**
 * 创建一个 AI 评分器。
 *
 * @param config `{ baseUrl, model, apiKey, timeoutMs }`（明文 Key 由调用方从 `secrets` 表读出传入）
 * @param offlineDeps 透传给离线评分器（单测可注入固定时间/随机源）
 */
export function createLlmScorer(
  config: { baseUrl: string; model: string; apiKey: string; timeoutMs: number },
  offlineDeps?: { now?: number; random?: () => number },
): LlmTranslationScorer {
  const offline = createOfflineScorer(offlineDeps);

  async function review(req: LlmReviewRequest, onDelta?: (chunk: string) => void): Promise<LlmScoreResult> {
    // 先算离线分（纯函数、零成本），作为得分点命中明细与 AI 失败时的对照
    const offlineResult = await offline.score(req);

    const raw = await streamChat(
      {
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey,
        messages: buildMessages(req),
        timeoutMs: config.timeoutMs,
      },
      onDelta ?? ((): void => undefined),
    );

    const parsed = parseLlmReview(raw);
    if (!parsed) {
      // 200 但内容不可解析 —— 绝不展示半成品分数，直接判 parse 让 UI 回退
      throw new LlmError('parse');
    }
    return toLlmResult(parsed, offlineResult);
  }

  return {
    id: 'llm',
    label: LLM_SCORER_LABEL,
    review,
    async score(req: ScoreRequest): Promise<ScoreResult> {
      // `TranslationScorer` 契约只有 text + keyPoints；AI 卡需要原文与参考译文，
      // 调用方应直接用 `review()`。这里对缺失字段给空串，评分仍可完成（质量下降但不崩）。
      const extended: LlmReviewRequest = {
        ...req,
        zh: (req as Partial<LlmReviewRequest>).zh ?? '',
        reference: (req as Partial<LlmReviewRequest>).reference ?? '',
      };
      const result = await review(extended);
      return {
        total: result.total,
        hit: result.hit,
        ratio: result.ratio,
        points: result.points,
        band: result.band,
        scoredBy: result.scoredBy,
      };
    },
  };
}

/** 便捷：从 `LlmScoreResult` 压成落库快照（错句本 / 统计） */
export function toLlmScore(result: LlmScoreResult): Score {
  return toScore(result);
}
