import { beforeEach, describe, expect, it } from 'vitest';
import type { Cet4Database } from '@/data/db/db';
import { bulkPutWords } from '@/data/repos/wordRepo';
import { ensureCard } from '@/data/repos/cardRepo';
import { addVocab } from '@/data/repos/vocabRepo';
import { addWrong } from '@/data/repos/wrongRepo';
import { createCard } from '@/domain/fsrs/types';
import { CET4_BOUNDARY, CORE_BOUNDARY } from '@/domain/word/tier';
import type { Tier, Word } from '@/domain/word/types';
import { filterByTier, loadQuizPool, rankRangeForTier, takeShuffled } from '@/services/quizPool';
import { freshDb } from './examFixture';

const NOW = 1_700_000_000_000;

function makeWord(rank: number, tier: Tier = 'cet4'): Word {
  return {
    id: `w_pool_${rank}`,
    headword: `word${rank}`,
    variants: [],
    senses: [{ pos: 'unknown', zh: `释义${rank}` }],
    freqRank: rank,
    freqCount: 40,
    tier,
    chunk: 1,
    sentenceCount: 0,
    source: 'exam-data/CETVocabulary@test',
    license: 'CC BY-NC-SA 4.0',
  };
}

/** 造 40 个词：前 20 个 core2104，后 20 个 cet4 */
function makeWords(): Word[] {
  return [
    ...Array.from({ length: 20 }, (_, i) => makeWord(100 + i, 'core2104')),
    ...Array.from({ length: 20 }, (_, i) => makeWord(CORE_BOUNDARY + 1 + i, 'cet4')),
  ];
}

let db: Cet4Database;
let words: Word[];

beforeEach(async () => {
  db = freshDb('pool');
  words = makeWords();
  await bulkPutWords(words, db);
});

describe('rankRangeForTier · 档位 → 词频区间', () => {
  it('core2104 = 前 2104 个', () => {
    expect(rankRangeForTier('core2104')).toEqual([1, CORE_BOUNDARY]);
  });

  it('cet4 = 2105..5278（**不含**已属 core 的部分，否则两档会重叠）', () => {
    expect(rankRangeForTier('cet4')).toEqual([CORE_BOUNDARY + 1, CET4_BOUNDARY]);
  });

  it('extended = 5279 起；all = 全区间', () => {
    expect(rankRangeForTier('extended')).toEqual([CET4_BOUNDARY + 1, Number.MAX_SAFE_INTEGER]);
    expect(rankRangeForTier('all')).toEqual([1, Number.MAX_SAFE_INTEGER]);
  });
});

describe('filterByTier', () => {
  it("'all' 原样返回；指定档位只留该档", () => {
    expect(filterByTier(words, 'all')).toHaveLength(40);
    expect(filterByTier(words, 'core2104')).toHaveLength(20);
    expect(filterByTier(words, 'cet4').every((w) => w.tier === 'cet4')).toBe(true);
  });
});

describe('takeShuffled · 确定性', () => {
  it('同 seed 必得同一批（支持"重做同一套"）', () => {
    const a = takeShuffled(words, 10, 42).map((w) => w.id);
    const b = takeShuffled(words, 10, 42).map((w) => w.id);
    expect(a).toEqual(b);
  });

  it('不同 seed 会得到不同顺序（否则测验永远是同一批词）', () => {
    const a = takeShuffled(words, 10, 1).map((w) => w.id);
    const b = takeShuffled(words, 10, 999).map((w) => w.id);
    expect(a).not.toEqual(b);
  });

  it('count 超过长度时返回全部；count<=0 返回空', () => {
    expect(takeShuffled(words, 999, 1)).toHaveLength(40);
    expect(takeShuffled(words, 0, 1)).toHaveLength(0);
    expect(takeShuffled(words, -5, 1)).toHaveLength(0);
  });

  it('不修改入参数组（洗牌在副本上进行）', () => {
    const snapshot = words.map((w) => w.id);
    takeShuffled(words, 10, 7);
    expect(words.map((w) => w.id)).toEqual(snapshot);
  });
});

describe('loadQuizPool · 按来源取词', () => {
  it("'learned'：只考已有卡片的词，suspended 的不算", async () => {
    await ensureCard(words[0]!.id, words[0]!.freqRank, NOW, db);
    await ensureCard(words[1]!.id, words[1]!.freqRank, NOW, db);
    await db.cards.put({ ...createCard(words[2]!.id, words[2]!.freqRank, NOW), suspended: true });

    const pool = await loadQuizPool({ source: 'learned', tier: 'all', count: 10, seed: 1, instance: db });
    const ids = pool.targets.map((w) => w.id);
    expect(ids).toContain(words[0]!.id);
    expect(ids).toContain(words[1]!.id);
    expect(ids).not.toContain(words[2]!.id);
  });

  it("'wrong'：考错题本里的词（这是最省时间的提分项）", async () => {
    await addWrong(
      { wordId: words[5]!.id, source: 'quiz', wrongCount: 3, firstWrongAt: NOW, lastWrongAt: NOW, enqueued: true, nextDue: NOW, resolved: false },
      db,
    );
    const pool = await loadQuizPool({ source: 'wrong', tier: 'all', count: 10, seed: 1, instance: db });
    expect(pool.targets.map((w) => w.id)).toEqual([words[5]!.id]);
  });

  it("'vocab'：考生词本里收藏的词", async () => {
    await addVocab({ wordId: words[7]!.id, now: NOW }, db);
    const pool = await loadQuizPool({ source: 'vocab', tier: 'all', count: 10, seed: 1, instance: db });
    expect(pool.targets.map((w) => w.id)).toEqual([words[7]!.id]);
  });

  it("'rank'：按词频档位取，且受档位过滤", async () => {
    const pool = await loadQuizPool({ source: 'rank', tier: 'core2104', count: 5, seed: 3, instance: db });
    expect(pool.targets).toHaveLength(5);
    expect(pool.targets.every((w) => w.tier === 'core2104')).toBe(true);
  });

  it('词池为空时不抛错，返回空 targets（UI 会给出提示而非白屏）', async () => {
    const pool = await loadQuizPool({ source: 'wrong', tier: 'all', count: 10, seed: 1, instance: db });
    expect(pool.targets).toEqual([]);
  });

  it('★ 干扰项池比被考池大 —— 否则挑不出像样的干扰项', async () => {
    await ensureCard(words[0]!.id, words[0]!.freqRank, NOW, db);
    const pool = await loadQuizPool({ source: 'learned', tier: 'all', count: 1, seed: 1, instance: db });
    expect(pool.targets).toHaveLength(1);
    expect(pool.distractors.length).toBeGreaterThan(pool.targets.length);
  });
});
