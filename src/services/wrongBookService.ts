import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { WrongSource } from '@/data/db/rows';
import { addWrong, findWrong, putWrong, type WrongLookup } from '@/data/repos/wrongRepo';
import { SAME_DAY_REQUEUE_MS } from '@/domain/fsrs/scheduler';
import type { WrongBookRow } from '@/data/db/rows';

/**
 * 错题 → FSRS 入队（差异化机会 ④）—— 服务编排层。
 *
 * 语义：错题本不是「死列表」，而是 FSRS 队列的**活跃来源**。
 * 每次答错（Again）都会：
 *   ① 累加该题 wrongCount；
 *   ② 把 nextDue 设为 `now + 10 分钟`（当日重现，与背词主流程一致）；
 *   ③ 标记 enqueued=true（防止重复入队）。
 */

export interface EnqueueWrongInput {
  wordId?: string;
  questionId?: string;
  paperId?: string;
  source: WrongSource;
  now?: number;
  /** 重现间隔，默认 10 分钟（与 scheduler.SAME_DAY_REQUEUE_MS 对齐） */
  requeueMs?: number;
}

/** 记录一次答错，返回落库后的错题条目 */
export async function enqueueWrong(
  input: EnqueueWrongInput,
  instance: Cet4Database = defaultDb,
): Promise<WrongBookRow> {
  const now = input.now ?? Date.now();
  const requeueMs = input.requeueMs ?? SAME_DAY_REQUEUE_MS;

  const lookup: WrongLookup = { source: input.source };
  if (input.wordId !== undefined) lookup.wordId = input.wordId;
  if (input.questionId !== undefined) lookup.questionId = input.questionId;
  if (input.paperId !== undefined) lookup.paperId = input.paperId;

  const existing = await findWrong(lookup, instance);
  if (existing) {
    const next: WrongBookRow = {
      ...existing,
      wrongCount: existing.wrongCount + 1,
      lastWrongAt: now,
      nextDue: now + requeueMs,
      enqueued: true,
      resolved: false,
    };
    await putWrong(next, instance);
    return next;
  }

  const entry: WrongBookRow = {
    source: input.source,
    wrongCount: 1,
    firstWrongAt: now,
    lastWrongAt: now,
    enqueued: true,
    nextDue: now + requeueMs,
    resolved: false,
  };
  if (input.wordId !== undefined) entry.wordId = input.wordId;
  if (input.questionId !== undefined) entry.questionId = input.questionId;
  if (input.paperId !== undefined) entry.paperId = input.paperId;

  const id = await addWrong(entry, instance);
  return { ...entry, id };
}

/**
 * 归档一条错题（连续答对 N 次 / 用户手动移除）。
 * 归档后不再出现在错题队列，但保留记录供回溯。
 */
export async function resolveWrong(
  id: number,
  instance: Cet4Database = defaultDb,
): Promise<WrongBookRow | undefined> {
  const entry = await instance.wrongBook.get(id);
  if (!entry) return undefined;
  const next: WrongBookRow = { ...entry, resolved: true, enqueued: false };
  await putWrong(next, instance);
  return next;
}

/** 恢复一条错题（误删 / 需要重练） */
export async function reopenWrong(
  id: number,
  now: number = Date.now(),
  instance: Cet4Database = defaultDb,
): Promise<WrongBookRow | undefined> {
  const entry = await instance.wrongBook.get(id);
  if (!entry) return undefined;
  const next: WrongBookRow = {
    ...entry,
    resolved: false,
    enqueued: true,
    nextDue: now + SAME_DAY_REQUEUE_MS,
  };
  await putWrong(next, instance);
  return next;
}

export { listWrong, countWrong, listWrongDue } from '@/data/repos/wrongRepo';
