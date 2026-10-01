/**
 * 评分映射 —— 铁律 A1：纯函数，零 React / 零 IO。
 *
 * 把 PRD R02 的「三级自评」+ R20「偷看详情扣分」收敛为 ts-fsrs 的四分评级。
 * 映射表 RATING_MAP 的唯一真源在 `types.ts`（M0 已冻结），本文件负责**规则**：
 *   ① 查表；② 犹豫降级；③ peekPenalty 开关。
 */

import {
  HESITATION_MS,
  RATING_MAP,
  type FsrsRating,
  type RatingInput,
} from './types';

export { HESITATION_MS, RATING_MAP };

export interface RatingOptions {
  /** R20 偷看扣分开关：false 时忽略 peeked（不因偷看降级） */
  peekPenalty?: boolean;
  /** 犹豫阈值（ms），默认 8000；自评「认识」但超时 → 降级为 Good */
  hesitationMs?: number;
}

/**
 * 三级自评 + 偷看 + 耗时 → FSRS 四分评级。
 *
 * 规则：
 * - 基础映射：`${self}-${peeked ? 'peek' : 'clean'}` → RATING_MAP
 * - 偷看扣分（peekPenalty=true，默认开）：known 由 Easy 降为 Good、fuzzy 降为 Hard
 * - 犹豫降级（R20 附加规则）：self='known' 且耗时 > 阈值 → 最高只给 Good
 */
export function resolveRating(input: RatingInput, options: RatingOptions = {}): FsrsRating {
  const peekPenalty = options.peekPenalty ?? true;
  const peeked = peekPenalty ? input.peeked : false;
  const key = `${input.self}-${peeked ? 'peek' : 'clean'}`;
  let rating = RATING_MAP[key] ?? 1;

  const threshold = options.hesitationMs ?? HESITATION_MS;
  if (input.self === 'known' && rating > 3 && input.elapsedMs > threshold) {
    rating = 3;
  }
  return rating;
}

/**
 * 是否应把本次作答记为「错题」（差异化的错题本来源）。
 * 只有 unknown（评分 1 / Again）才进错题本 —— 模糊不算错。
 */
export function isWrongAnswer(rating: FsrsRating): boolean {
  return rating === 1;
}

/** 是否算「答对」（用于日统计 correct 计数） */
export function isCorrectAnswer(rating: FsrsRating): boolean {
  return rating >= 3;
}
