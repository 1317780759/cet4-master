import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import { countDue, listDue, listDueSoon } from '@/data/repos/cardRepo';
import type { ReviewCard } from '@/domain/fsrs/types';

/**
 * 到期复习队列构建 —— 服务编排层（铁律 A2：UI 只经 services → repos）。
 *
 * ★ 防雪崩：遵循 settings.reviewLimit（默认 200），超上限时裁剪并标记 trimmed，
 *   避免长期未登录后一次性弹出上千张卡。
 */

/** Again 卡片「当日重现」等待窗口（ms）——队列暂空时据此判定是否存在临期卡（R-A1） */
export const REQUEUE_WINDOW_MS = 60_000;

/** 临期卡概览（R-A1） */
export interface DueSoon {
  count: number;
  /** 最早到期时刻；无则 null */
  earliestDueAt: number | null;
}

export interface ReviewQueue {
  /** 到期卡片，按 due 升序 */
  items: ReviewCard[];
  /** 到期总数（裁剪前） */
  totalDue: number;
  /** 是否因上限被裁剪 */
  trimmed: boolean;
  /** 本次上限 */
  limit: number;
}

export interface BuildQueueOptions {
  now?: number;
  limit?: number;
  instance?: Cet4Database;
}

/** 构建到期复习队列（含上限裁剪） */
export async function buildReviewQueue(options: BuildQueueOptions = {}): Promise<ReviewQueue> {
  const instance = options.instance ?? defaultDb;
  const now = options.now ?? Date.now();
  const limit = Math.max(0, Math.floor(options.limit ?? 200));
  const [totalDue, items] = await Promise.all([
    countDue(now, instance),
    listDue(now, limit, instance),
  ]);
  return { items, totalDue, trimmed: totalDue > items.length, limit };
}

/** 到期卡片数（首页「今日待复习」徽标） */
export async function countDueCards(
  now: number = Date.now(),
  instance: Cet4Database = defaultDb,
): Promise<number> {
  return countDue(now, instance);
}

/** 最近一张到期卡的 due（无到期卡返回 null）—— 用于「距离下次复习」倒计时 */
export async function nextDueAt(instance: Cet4Database = defaultDb): Promise<number | null> {
  const active = await instance.cards
    .orderBy('due')
    .filter((c) => !c.suspended)
    .limit(1)
    .toArray();
  return active[0]?.due ?? null;
}

/**
 * 距 now 之后 windowMs 内即将到期的卡（**不含**已到期）——用于区分「队列暂空」与「今日完成」。
 * ★ R-A1：队列耗尽时若仍有临期卡，应进入 waiting 而非直接显示「本组完成」。
 */
export async function peekDueSoon(
  now: number = Date.now(),
  windowMs: number = REQUEUE_WINDOW_MS,
  instance: Cet4Database = defaultDb,
): Promise<DueSoon> {
  const cards = await listDueSoon(now, windowMs, 200, instance);
  return { count: cards.length, earliestDueAt: cards[0]?.due ?? null };
}
