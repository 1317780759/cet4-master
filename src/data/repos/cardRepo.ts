import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { ReviewCard } from '@/domain/fsrs/types';
import { createCard } from '@/domain/fsrs/types';

/**
 * 复习卡片仓库 —— 用户进度区的核心。
 * ★ 数据管线（chunkLoader / cacheWarmer）**永不**触碰本表。
 */

export async function getCard(
  wordId: string,
  instance: Cet4Database = defaultDb,
): Promise<ReviewCard | undefined> {
  return instance.cards.get(wordId);
}

export async function putCard(card: ReviewCard, instance: Cet4Database = defaultDb): Promise<void> {
  await instance.cards.put(card);
}

export async function bulkPutCards(
  cards: readonly ReviewCard[],
  instance: Cet4Database = defaultDb,
): Promise<number> {
  if (cards.length === 0) return 0;
  await instance.cards.bulkPut(cards as ReviewCard[]);
  return cards.length;
}

/** 若不存在则创建一张新卡（引入新词的唯一入口） */
export async function ensureCard(
  wordId: string,
  freqRank: number,
  now: number = Date.now(),
  instance: Cet4Database = defaultDb,
): Promise<ReviewCard> {
  const existing = await getCard(wordId, instance);
  if (existing) return existing;
  const card = createCard(wordId, freqRank, now);
  await putCard(card, instance);
  return card;
}

export async function countCards(instance: Cet4Database = defaultDb): Promise<number> {
  return instance.cards.count();
}

/**
 * 到期卡片数（suspended 的不计入，见 R07）。
 * ★ 必须 `filter` 到非 suspended 后再 `count`，否则「已掌握」卡会被算进
 *   「今日待复习」徽标 —— 这正是独立验收捕获的边界缺陷。
 */
export async function countDue(
  now: number = Date.now(),
  instance: Cet4Database = defaultDb,
): Promise<number> {
  return instance.cards.where('due').belowOrEqual(now).filter((c) => !c.suspended).count();
}

/**
 * 取一批到期卡片（按 due 升序，超上限裁剪防雪崩）。
 * ★ 顺序关键：先 `filter`（排除 suspended）再 `limit`，避免 suspended 卡
 *   挤占上限、把真正到期的 active 卡挡在裁剪之外（反之会漏卡）。
 */
export async function listDue(
  now: number = Date.now(),
  limit = 200,
  instance: Cet4Database = defaultDb,
): Promise<ReviewCard[]> {
  return instance.cards
    .where('due')
    .belowOrEqual(now)
    .filter((c) => !c.suspended)
    .limit(limit)
    .toArray();
}

/** 按学习状态统计（Dashboard 掌握度分布用） */
export async function countByState(instance: Cet4Database = defaultDb): Promise<number[]> {
  const counts: number[] = [0, 0, 0, 0, 0];
  const rows = await instance.cards.toArray();
  for (const row of rows) {
    counts[row.state] = (counts[row.state] ?? 0) + 1;
  }
  return counts;
}

export async function deleteCard(
  wordId: string,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  await instance.cards.delete(wordId);
}
