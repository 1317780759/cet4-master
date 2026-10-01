import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { WrongBookRow } from '@/data/db/rows';

/**
 * 错题本仓库 —— 用户进度区。
 * ★ 数据管线永不触碰；差异化机会 ④ 的「错题 → FSRS 队列」落点。
 */

export interface WrongLookup {
  wordId?: string;
  questionId?: string;
  paperId?: string;
  source?: WrongBookRow['source'];
}

/** 按来源定位一条错题（用于累加 wrongCount 而非重复插入） */
export async function findWrong(
  lookup: WrongLookup,
  instance: Cet4Database = defaultDb,
): Promise<WrongBookRow | undefined> {
  const rows = await instance.wrongBook
    .filter((row) => {
      if (lookup.wordId !== undefined && row.wordId !== lookup.wordId) return false;
      if (lookup.questionId !== undefined && row.questionId !== lookup.questionId) return false;
      if (lookup.paperId !== undefined && row.paperId !== lookup.paperId) return false;
      if (lookup.source !== undefined && row.source !== lookup.source) return false;
      return true;
    })
    .first();
  return rows;
}

/** 新增一条错题，返回自增主键 */
export async function addWrong(
  entry: WrongBookRow,
  instance: Cet4Database = defaultDb,
): Promise<number> {
  return instance.wrongBook.add(entry);
}

/** 覆盖写入（保留 id） */
export async function putWrong(
  entry: WrongBookRow,
  instance: Cet4Database = defaultDb,
): Promise<number> {
  return instance.wrongBook.put(entry);
}

export async function getWrong(
  id: number,
  instance: Cet4Database = defaultDb,
): Promise<WrongBookRow | undefined> {
  return instance.wrongBook.get(id);
}

export interface ListWrongOptions {
  includeResolved?: boolean;
  limit?: number;
}

/** 列出错题（默认排除已归档，按 wrongCount 降序 = 最该攻克在前） */
export async function listWrong(
  options: ListWrongOptions = {},
  instance: Cet4Database = defaultDb,
): Promise<WrongBookRow[]> {
  const limit = options.limit ?? 500;
  const rows = await instance.wrongBook.toArray();
  return rows
    .filter((row) => options.includeResolved === true || !row.resolved)
    .sort((a, b) => {
      if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount;
      return b.lastWrongAt - a.lastWrongAt;
    })
    .slice(0, limit);
}

/** 未归档错题数（Dashboard 展示） */
export async function countWrong(instance: Cet4Database = defaultDb): Promise<number> {
  const rows = await instance.wrongBook.toArray();
  return rows.filter((row) => !row.resolved).length;
}

/** 取一批到期需重做的错题（差异化④：错题按 FSRS 调度重现） */
export async function listWrongDue(
  now: number = Date.now(),
  limit = 50,
  instance: Cet4Database = defaultDb,
): Promise<WrongBookRow[]> {
  const rows = await instance.wrongBook.where('nextDue').belowOrEqual(now).limit(limit).toArray();
  return rows.filter((row) => !row.resolved).sort((a, b) => a.nextDue - b.nextDue);
}

export async function deleteWrong(
  id: number,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  await instance.wrongBook.delete(id);
}
