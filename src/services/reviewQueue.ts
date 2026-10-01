import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import { countDue, listDue } from '@/data/repos/cardRepo';
import type { ReviewCard } from '@/domain/fsrs/types';

/**
 * 到期复习队列构建 —— 服务编排层（铁律 A2：UI 只经 services → repos）。
 *
 * ★ 防雪崩：遵循 settings.reviewLimit（默认 200），超上限时裁剪并标记 trimmed，
 *   避免长期未登录后一次性弹出上千张卡。
 */

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
  const rows = await instance.cards.orderBy('due').limit(4).toArray();
  const active = rows.find((c) => !c.suspended);
  return active ? active.due : null;
}
