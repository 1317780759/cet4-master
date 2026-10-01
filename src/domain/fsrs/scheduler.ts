/**
 * FSRS 调度器 —— 铁律 A1：纯函数封装，零 React / 零 IO / 零网络。
 *
 * ★ 参数策略（实现方案 R7「伪间隔重复」）：**直接使用 ts-fsrs@5.4.2 默认参数**
 *   （`request_retention = 0.9`、`enable_fuzz = false`），M1 绝不调参、绝不魔改。
 *   因此间隔是**确定性**的，单测可以精确断言数值。
 *
 * 与 ts-fsrs 默认行为的差异只有一处，且是**产品策略**而非算法调参：
 *   `Again`（评分 1）后强制 `due = now + 10 分钟`（当日重现）。
 *   ts-fsrs 默认对新卡 Again 给 1 分钟、对成熟卡 Again 给 10 分钟（relearning step）；
 *   统一成 10 分钟，既符合方案 5.2 时序图，也让「Again → 约 10 分钟后重现」可断言。
 */

import { fsrs, type Card } from 'ts-fsrs';
import { fromFsrsCard, toFsrsCard } from './adapter';
import { RATING_VALUES, type FsrsRating, type ReviewCard } from './types';

/** 当日重现间隔：Again 之后 10 分钟（ms）。产品策略常量，非 FSRS 参数 */
export const SAME_DAY_REQUEUE_MS = 10 * 60 * 1000;

/**
 * 全局唯一的 FSRS 引擎实例。
 * 使用默认参数（R7：M1 不调参），无副作用，可安全共享。
 */
const engine = fsrs();

/** 评级的可读入类型：仅接受 1..4（排除 Manual=0） */
export function isGrade(value: number): value is FsrsRating {
  return RATING_VALUES.includes(value as FsrsRating);
}

/**
 * 按评级推进一张卡片的 FSRS 状态（**不含**当日重现策略）。
 *
 * Again → 新卡约 1 分钟、成熟卡约 10 分钟（进入 Relearning）；
 * Good  → 学习阶段 10 分钟，随后进入 Review 且间隔逐次递增。
 */
export function next(card: ReviewCard, rating: FsrsRating, now: number = Date.now()): ReviewCard {
  const advanced: Card = engine.next(toFsrsCard(card), now, rating).card;
  return fromFsrsCard(advanced, card);
}

/**
 * 当日重现策略：把 due 强制设置为 `now + 10 分钟`，保留 FSRS 算出的记忆状态。
 * 返回新对象，不修改入参（保持纯函数）。
 */
export function requeueSameDay(card: ReviewCard, now: number = Date.now()): ReviewCard {
  return {
    ...card,
    due: now + SAME_DAY_REQUEUE_MS,
    elapsedDays: 0,
    scheduledDays: 0,
  };
}

export interface ScheduleResult {
  /** 推进后的卡片（Again 时已应用当日重现策略） */
  card: ReviewCard;
  /** 是否触发了「当日重现」（rating === Again） */
  requeuedSameDay: boolean;
}

/**
 * 评分 → 新卡片的**唯一**调度入口（studySession 调用它）。
 * 内部 = FSRS 推进 + Again 当日重现策略。
 */
export function schedule(
  card: ReviewCard,
  rating: FsrsRating,
  now: number = Date.now(),
): ScheduleResult {
  const advanced = next(card, rating, now);
  if (rating === 1) {
    return { card: requeueSameDay(advanced, now), requeuedSameDay: true };
  }
  return { card: advanced, requeuedSameDay: false };
}

/**
 * 预览四个评级的落点（RatingBar 用来显示「10 分钟 / 10 分钟 / 8 天」这类提示）。
 * 与 `schedule` 保持同一套策略，避免 UI 与实际调度漂移。
 */
export function preview(
  card: ReviewCard,
  now: number = Date.now(),
): Record<FsrsRating, ScheduleResult> {
  const result = {} as Record<FsrsRating, ScheduleResult>;
  for (const rating of RATING_VALUES) {
    result[rating] = schedule(card, rating, now);
  }
  return result;
}

/** 卡片是否已到期 */
export function isDue(card: ReviewCard, now: number = Date.now()): boolean {
  return !card.suspended && card.due <= now;
}

/**
 * 把时间间隔渲染成人类可读文案（UI 提示用）。
 * < 1 小时 → 分钟；< 1 天 → 小时；否则天数。
 */
export function formatInterval(fromMs: number, toMs: number): string {
  const delta = Math.max(0, toMs - fromMs);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`;
  const hours = Math.round(delta / 3_600_000);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.round(delta / 86_400_000)} 天`;
}

/** 卡片记忆状态的粗略档位，用于「掌握度分布」统计 */
export function masteryBucket(card: ReviewCard): 'new' | 'learning' | 'young' | 'mature' {
  if (card.state === 0 || card.reps === 0) return 'new';
  if (card.state === 1 || card.state === 3) return 'learning';
  return card.scheduledDays >= 21 ? 'mature' : 'young';
}
