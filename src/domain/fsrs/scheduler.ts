/**
 * FSRS 调度器 —— 铁律 A1：纯函数封装，零 React / 零 IO / 零网络。
 *
 * ★ 参数策略（实现方案 R7「伪间隔重复」）：**直接使用 ts-fsrs@5.4.2 默认参数**
 *   （`request_retention = 0.9`、`enable_fuzz = false`），M1 绝不调参、绝不魔改。
 *   因此间隔是**确定性**的，单测可以精确断言数值。
 *
 * 与 ts-fsrs 默认行为的差异只有一处，且是**产品策略**而非算法调参：
 *   `Again`（评分 1）**保留 ts-fsrs 原生落点**（新卡 1 分钟、成熟卡 relearning step 10 分钟），
 *   再以同一时刻 `Hard` 的 due 为**上界钳制**：
 *     `due = min(next(card, Again, now).due, next(card, Hard, now).due)`
 *
 *   为什么要钳制？不做保护时，某些卡片状态下 Again 的 due 会晚于 Hard，出现
 *   「不认识比模糊更晚回来」的**评分倒挂**，违反「越不会越早见」的间隔重复本意。
 *   取 min 后：
 *     - 新卡场景 → Again = 1min < Hard = 6min，**严格区分**「完全不认识 / 有点模糊」；
 *     - 成熟卡 / Relearning（FSRS relearning step = 10min）→ Again = 10min，
 *       方案「Again ≈ 10 分钟」的语义在成熟卡上完整保留。
 *   这是应用层的**顺序保护（钳制）**，不是对 ts-fsrs 全局参数（R7）的调整。
 */

import { fsrs, type Card } from 'ts-fsrs';
import { fromFsrsCard, toFsrsCard } from './adapter';
import { RATING_VALUES, type FsrsRating, type ReviewCard } from './types';

/**
 * 当日重现基准间隔：10 分钟（ms）。
 * ★ 自「Again 保留原生值再钳制」改造后，本常量**不再**参与卡片 FSRS 调度
 *   （卡片 Again 间隔由 ts-fsrs 原生值决定，再以 Hard 的 due 为上界钳制）。
 *   它当前服务于**错题本**的重现间隔（`wrongBookService.nextDue`，独立于卡片调度）。
 */
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
 * 当日重现策略：保留 `card.due`（= ts-fsrs 原生 Again 落点），仅以 `hardDue`
 * 为**上界钳制**，并把 elapsedDays / scheduledDays 归零（当日重现语义）。
 * `hardDue` 缺省为 `+∞`，此时 due 保持原生值不变。
 * 返回新对象，不修改入参（保持纯函数）。
 */
export function requeueSameDay(
  card: ReviewCard,
  hardDue: number = Number.POSITIVE_INFINITY,
): ReviewCard {
  return {
    ...card,
    due: Math.min(card.due, hardDue),
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
 * 内部 = FSRS 推进 + Again 当日重现策略（保留原生落点，再以 Hard 的 due 为上界钳制）。
 */
export function schedule(
  card: ReviewCard,
  rating: FsrsRating,
  now: number = Date.now(),
): ScheduleResult {
  const advanced = next(card, rating, now);
  if (rating === 1) {
    // 钳制：Again 保留原生落点（新卡 1min / 成熟卡 relearning 10min），不晚于同一时刻 Hard 的 due。
    const hardDue = next(card, 2, now).due;
    return { card: requeueSameDay(advanced, hardDue), requeuedSameDay: true };
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
