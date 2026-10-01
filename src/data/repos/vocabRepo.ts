import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { VocabBookRow } from '@/data/db/rows';

/**
 * 生词本仓库 —— 用户进度区。
 * ★ 与错题本分离的「主动收藏」语义（方案 3.4 注释）：
 *   错题本 = 被动记录（答错才进）；生词本 = 主动收藏（可带出处 origin）。
 */

export interface AddVocabInput {
  wordId: string;
  origin?: VocabBookRow['origin'];
  note?: string;
  now?: number;
}

/** 加入生词本（幂等：已存在则返回已有条目） */
export async function addVocab(
  input: AddVocabInput,
  instance: Cet4Database = defaultDb,
): Promise<VocabBookRow> {
  const existing = await findVocab(input.wordId, instance);
  if (existing) return existing;
  const entry: VocabBookRow = {
    wordId: input.wordId,
    addedAt: input.now ?? Date.now(),
    promoted: false,
  };
  if (input.origin) entry.origin = input.origin;
  if (input.note) entry.note = input.note;
  const id = await instance.vocabBook.add(entry);
  return { ...entry, id };
}

/** 按 wordId 查生词本条目 */
export async function findVocab(
  wordId: string,
  instance: Cet4Database = defaultDb,
): Promise<VocabBookRow | undefined> {
  return instance.vocabBook.where('wordId').equals(wordId).first();
}

/** 列出未转入正式队列的生词 */
export async function listVocab(
  limit = 500,
  instance: Cet4Database = defaultDb,
): Promise<VocabBookRow[]> {
  const rows = await instance.vocabBook.orderBy('addedAt').reverse().limit(limit).toArray();
  return rows;
}

export async function countVocab(instance: Cet4Database = defaultDb): Promise<number> {
  return instance.vocabBook.count();
}

/** 标记为已转入正式学习队列 */
export async function promoteVocab(
  wordId: string,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  const entry = await findVocab(wordId, instance);
  if (!entry?.id) return;
  await instance.vocabBook.put({ ...entry, promoted: true });
}

/** 移出生词本 */
export async function removeVocab(
  wordId: string,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  const entry = await findVocab(wordId, instance);
  if (entry?.id === undefined) return;
  await instance.vocabBook.delete(entry.id);
}
