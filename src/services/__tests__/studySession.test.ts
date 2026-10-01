import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Cet4Database } from '@/data/db/db';
import { closeDatabase, openDatabase } from '@/data/db/migrations';
import { getCard, putCard } from '@/data/repos/cardRepo';
import { bulkPutWords } from '@/data/repos/wordRepo';
import { listSentencesForWord } from '@/data/repos/sentenceRepo';
import { createCard, type ReviewCard } from '@/domain/fsrs/types';
import { SAME_DAY_REQUEUE_MS } from '@/domain/fsrs/scheduler';
import { toDateKey } from '@/lib/date';
import { buildReviewQueue } from '@/services/reviewQueue';
import { finishSession, rateWord, setCardSuspended, startSession } from '@/services/studySession';
import type { Word } from '@/domain/word/types';

const NOW = new Date('2026-10-01T09:00:00+08:00').getTime();

function makeWord(rank: number): Word {
  return {
    id: `w_${rank}`,
    headword: `word${rank}`,
    variants: [`word${rank}s`],
    senses: [{ pos: 'n', zh: `释义${rank}` }],
    freqRank: rank,
    freqCount: 1000 - rank,
    tier: rank <= 2104 ? 'core2104' : 'cet4',
    chunk: 1,
    sentenceCount: 0,
    source: 'test',
    license: 'CC BY-NC-SA 4.0',
  };
}

let db: Cet4Database;

beforeEach(async () => {
  db = createDb(`svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await openDatabase(db);
  const words = Array.from({ length: 30 }, (_, i) => makeWord(i + 1));
  await bulkPutWords(words, db);
});

afterEach(async () => {
  await closeDatabase(db);
  await db.delete();
});

describe('services/studySession · startSession（选词）', () => {
  it('新词队列严格按 freqRank 升序，且全部标记为新词', async () => {
    const queue = await startSession('learn', { dailyGoal: 5, tier: 'core2104', now: NOW }, db);
    expect(queue.items).toHaveLength(5);
    expect(queue.newCount).toBe(5);
    expect(queue.reviewCount).toBe(0);
    expect(queue.items.map((i) => i.word.freqRank)).toEqual([1, 2, 3, 4, 5]);
    expect(queue.items.every((i) => i.isNew)).toBe(true);
  });

  it('已建卡的词不会被再次引入（未到期的卡也不算新词）', async () => {
    await putCard(
      { ...createCard('w_1', 1, NOW), due: NOW + 86_400_000, state: 2, reps: 1 },
      db,
    );
    const queue = await startSession('learn', { dailyGoal: 3, tier: 'core2104', now: NOW }, db);
    expect(queue.newCount).toBe(3);
    expect(queue.items.map((i) => i.word.id)).toEqual(['w_2', 'w_3', 'w_4']);
  });

  it('到期卡片进入 learn 队列的复习部分', async () => {
    const due: ReviewCard = { ...createCard('w_20', 20, NOW - 100_000), due: NOW - 1000, state: 2, reps: 3 };
    await putCard(due, db);
    const queue = await startSession('learn', { dailyGoal: 2, tier: 'core2104', now: NOW }, db);
    expect(queue.reviewCount).toBe(1);
    expect(queue.items[0].word.id).toBe('w_20');
    expect(queue.items[0].isNew).toBe(false);
  });

  it('review 模式不引入新词', async () => {
    const due: ReviewCard = { ...createCard('w_7', 7, NOW - 100_000), due: NOW - 1000 };
    await putCard(due, db);
    const queue = await startSession('review', { dailyGoal: 20, now: NOW }, db);
    expect(queue.newCount).toBe(0);
    expect(queue.items.map((i) => i.word.id)).toEqual(['w_7']);
  });
});

describe('services/studySession · rateWord（评级 + 落库 + 日志 + 错题）', () => {
  it('认识（clean）→ 卡片推进、日志写入、日统计累加、不进错题本', async () => {
    const queue = await startSession('learn', { dailyGoal: 1, tier: 'core2104', now: NOW }, db);
    const item = queue.items[0];
    const result = await rateWord(
      item,
      { self: 'known', peeked: false, elapsedMs: 1500 },
      { now: NOW },
      db,
    );
    expect(result.rating).toBe(4);
    expect(result.isWrong).toBe(false);
    expect(result.requeuedSameDay).toBe(false);

    const saved = await getCard('w_1', db);
    expect(saved).toMatchObject({ wordId: 'w_1', reps: 1 });

    const logs = await db.studyLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ wordId: 'w_1', action: 'learn', rating: 4, date: toDateKey(NOW) });

    const stat = await db.dailyStats.get(toDateKey(NOW));
    expect(stat).toMatchObject({ newLearned: 1, reviewed: 1, correct: 1, wrong: 0 });
    expect(await db.wrongBook.count()).toBe(0);
  });

  it('不认识（unknown）→ Again：卡片 due = now + 10 分钟，且写入错题本', async () => {
    const queue = await startSession('learn', { dailyGoal: 1, tier: 'core2104', now: NOW }, db);
    const result = await rateWord(
      queue.items[0],
      { self: 'unknown', peeked: false, elapsedMs: 4000 },
      { now: NOW },
      db,
    );
    expect(result.rating).toBe(1);
    expect(result.requeuedSameDay).toBe(true);
    expect(result.card.due - NOW).toBe(SAME_DAY_REQUEUE_MS);

    const saved = await getCard('w_1', db);
    expect(saved?.due).toBe(NOW + SAME_DAY_REQUEUE_MS);

    const wrong = await db.wrongBook.toArray();
    expect(wrong).toHaveLength(1);
    expect(wrong[0]).toMatchObject({ wordId: 'w_1', source: 'card', enqueued: true, wrongCount: 1 });
    expect(wrong[0].nextDue).toBe(NOW + SAME_DAY_REQUEUE_MS);

    const stat = await db.dailyStats.get(toDateKey(NOW));
    expect(stat).toMatchObject({ reviewed: 1, correct: 0, wrong: 1 });
  });

  it('偷看 + 认识 → 降级为 Good（rating=3）', async () => {
    const queue = await startSession('learn', { dailyGoal: 1, tier: 'core2104', now: NOW }, db);
    const result = await rateWord(
      queue.items[0],
      { self: 'known', peeked: true, elapsedMs: 1000 },
      { now: NOW },
      db,
    );
    expect(result.rating).toBe(3);
  });

  it('同一词再次答错 → wrongCount 累加而非重复插入', async () => {
    const queue = await startSession('learn', { dailyGoal: 1, tier: 'core2104', now: NOW }, db);
    await rateWord(queue.items[0], { self: 'unknown', peeked: false, elapsedMs: 1000 }, { now: NOW }, db);
    await rateWord(
      { ...queue.items[0], card: (await getCard('w_1', db))! },
      { self: 'unknown', peeked: false, elapsedMs: 1000 },
      { now: NOW + 60_000 },
      db,
    );
    const wrong = await db.wrongBook.toArray();
    expect(wrong).toHaveLength(1);
    expect(wrong[0].wrongCount).toBe(2);
  });
});

describe('services/reviewQueue', () => {
  it('到期队列按 due 升序 + 上限裁剪标记', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await putCard({ ...createCard(`w_${i}`, i, NOW - 100_000), due: NOW - i * 1000 }, db);
    }
    const queue = await buildReviewQueue({ now: NOW, limit: 3, instance: db });
    expect(queue.items).toHaveLength(3);
    expect(queue.totalDue).toBe(5);
    expect(queue.trimmed).toBe(true);
    expect(queue.items.map((c) => c.due)).toEqual([NOW - 5000, NOW - 4000, NOW - 3000]);
  });

  it('suspended 卡片不计入到期', async () => {
    await putCard({ ...createCard('w_1', 1, NOW - 100_000), due: NOW - 1000, suspended: true }, db);
    const queue = await buildReviewQueue({ now: NOW, instance: db });
    expect(queue.items).toHaveLength(0);
  });
});

describe('services/studySession · finishSession / setCardSuspended', () => {
  it('finishSession 汇总当日统计与连续打卡', async () => {
    const queue = await startSession('learn', { dailyGoal: 2, tier: 'core2104', now: NOW }, db);
    await rateWord(queue.items[0], { self: 'known', peeked: false, elapsedMs: 1000 }, { now: NOW }, db);
    await rateWord(queue.items[1], { self: 'unknown', peeked: false, elapsedMs: 1000 }, { now: NOW }, db);
    const summary = await finishSession(NOW, db);
    expect(summary).toMatchObject({ newLearned: 2, reviewed: 2, correct: 1, wrong: 1, streak: 1 });
  });

  it('setCardSuspended 把卡片移出到期队列（R07 已掌握）', async () => {
    const card = { ...createCard('w_1', 1, NOW - 100_000), due: NOW - 1000 };
    await putCard(card, db);
    await setCardSuspended(card, true, db);
    const queue = await buildReviewQueue({ now: NOW, instance: db });
    expect(queue.items).toHaveLength(0);
    expect((await getCard('w_1', db))?.suspended).toBe(true);
  });
});

describe('services · 例句能力（M1 无语料时优雅降级）', () => {
  it('listSentencesForWord 返回空数组（不阻塞背词）', async () => {
    expect(await listSentencesForWord('w_1', db)).toEqual([]);
  });
});
