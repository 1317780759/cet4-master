import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  DB_SCHEMA,
  MIRROR_STORES,
  PROGRESS_STORES,
  SYSTEM_STORES,
  type Cet4Database,
} from '../db';
import { closeDatabase, openDatabase, verifySchema } from '../migrations';
import { clearMirror } from '@/data/repos/wordRepo';
import type { Word } from '@/domain/word/types';

/**
 * Dexie schema 冒烟测试 —— 对应 M0 验收标准：
 * 「Dexie schema version 1 建表成功，10+ store 全部可读写」。
 * fake-indexeddb 由 tests/setup.ts 全局注入。
 */

function makeWord(id: string, freqRank: number): Word {
  return {
    id,
    headword: id.replace(/^w_/, ''),
    variants: [],
    senses: [{ pos: 'unknown', zh: '测试' }],
    freqRank,
    freqCount: 100 - freqRank,
    tier: freqRank <= 2104 ? 'core2104' : 'cet4',
    chunk: 1,
    sentenceCount: 0,
    source: 'test-source',
    license: 'CC BY-NC-SA 4.0',
  };
}

let db: Cet4Database;

beforeEach(async () => {
  db = createDb(`cet4-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await openDatabase(db);
});

afterEach(async () => {
  await closeDatabase(db);
  await db.delete();
});

describe('Dexie schema v1', () => {
  it('建表成功：16 个 store 全部可访问', async () => {
    const check = await verifySchema(db);
    expect(check.missing).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.stores).toHaveLength(16);
    expect(check.stores).toEqual([...MIRROR_STORES, ...PROGRESS_STORES, ...SYSTEM_STORES]);
    expect(Object.keys(DB_SCHEMA)).toHaveLength(16);
  });

  it('只读镜像区可读写', async () => {
    await db.words.put(makeWord('w_abandon', 1));
    await db.sentences.put({
      id: 's_000001',
      wordId: 'w_abandon',
      paperId: '2024-06-CET4-SET1',
      questionId: '2024-06-CET4-SET1:Q23',
      sectionKind: 'reading',
      en: 'He abandoned the plan.',
      targetForm: 'abandoned',
      span: [3, 12],
    });
    await db.papers.put({
      id: '2024-06-CET4-SET1',
      year: 2024,
      month: 6,
      setNo: 1,
      level: 'CET4',
      durationMin: 125,
      totalScore: 710,
      sectionMeta: [],
      provenance: 'derived',
      provenanceLabel: '真题同源模拟卷',
      confidence: {
        level: 'medium',
        hasTranscript: false,
        hasAudio: false,
        hasExplanation: true,
        answerCrossChecked: false,
        spotCheckRatio: 0,
        doubtCount: 0,
      },
    });
    await db.sections.put({
      id: '2024-06-CET4-SET1:R-A',
      paperId: '2024-06-CET4-SET1',
      kind: 'reading',
      subPart: 'Section A',
      order: 1,
      questions: [],
    });
    await db.questions.put({
      id: '2024-06-CET4-SET1:Q23',
      paperId: '2024-06-CET4-SET1',
      sectionId: '2024-06-CET4-SET1:R-A',
      kind: 'choice',
      no: 23,
      score: 3.55,
      answer: 'B',
      options: ['A', 'B', 'C', 'D'],
    });

    expect(await db.words.count()).toBe(1);
    expect(await db.sentences.count()).toBe(1);
    expect(await db.papers.count()).toBe(1);
    expect(await db.sections.count()).toBe(1);
    expect(await db.questions.count()).toBe(1);
    expect(await db.questions.get('2024-06-CET4-SET1:Q23')).toMatchObject({ answer: 'B' });
  });

  it('用户进度区可读写', async () => {
    await db.cards.put({
      wordId: 'w_abandon',
      due: 1_700_000_000_000,
      stability: 3,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 3,
      reps: 4,
      lapses: 1,
      state: 2,
      suspended: false,
      createdAt: 1_699_000_000_000,
      introsRank: 12,
    });
    const wrongId = await db.wrongBook.add({
      wordId: 'w_abandon',
      source: 'quiz',
      wrongCount: 2,
      firstWrongAt: 1,
      lastWrongAt: 2,
      enqueued: true,
      nextDue: 3,
      resolved: false,
    });
    const vocabId = await db.vocabBook.add({ wordId: 'w_abandon', addedAt: 1, promoted: false });
    const logId = await db.studyLogs.add({
      ts: 1,
      date: '2026-10-01',
      wordId: 'w_abandon',
      action: 'review',
    });
    await db.dailyStats.put({
      date: '2026-10-01',
      newLearned: 20,
      reviewed: 60,
      correct: 55,
      wrong: 5,
      minutes: 12,
      goalDone: true,
    });
    const quizId = await db.quizSessions.add({ startedAt: 1, type: 'choice' });
    await db.listeningProgress.put({ sectionId: 'sec-1', updatedAt: 2, playedSec: 30 });

    expect(await db.cards.get('w_abandon')).toMatchObject({ reps: 4, introsRank: 12 });
    expect(await db.wrongBook.get(wrongId)).toMatchObject({ wrongCount: 2 });
    expect(await db.vocabBook.get(vocabId)).toMatchObject({ promoted: false });
    expect(await db.studyLogs.get(logId)).toMatchObject({ date: '2026-10-01' });
    expect(await db.dailyStats.get('2026-10-01')).toMatchObject({ goalDone: true });
    expect(await db.quizSessions.get(quizId)).toMatchObject({ type: 'choice' });
    expect(await db.listeningProgress.get('sec-1')).toMatchObject({ playedSec: 30 });
  });

  it('模考区可读写（答题卡与 attempt 分离）', async () => {
    await db.answerSheets.put({
      id: 'attempt-1',
      attemptId: 'attempt-1',
      paperId: '2024-06-CET4-SET1',
      answers: {
        '2024-06-CET4-SET1:Q23': { questionId: '2024-06-CET4-SET1:Q23', value: 'B', flag: 'answered' },
      },
      elapsedSec: 1250,
      startedAt: 1,
      lastSavedAt: 2,
      remainingSec: 6250,
      audioState: 'idle',
    });
    await db.attempts.put({
      id: 'attempt-1',
      paperId: '2024-06-CET4-SET1',
      mode: 'mock',
      status: 'submitted',
      startedAt: 1,
      submittedAt: 2,
      elapsedSec: 7500,
      objectiveScore: 40,
      objectiveTotal: 55,
      sectionScores: [],
      scoreScaleNote: 'objective-only',
      wrongQuestionIds: [],
      newWordIds: [],
    });

    expect(await db.answerSheets.get('attempt-1')).toMatchObject({ remainingSec: 6250 });
    expect(await db.attempts.get('attempt-1')).toMatchObject({ scoreScaleNote: 'objective-only' });
  });

  it('系统区可读写', async () => {
    await db.meta.put({ key: 'dataVersion', value: '2026.10.01' });
    await db.audioCache.put({ url: 'tts://w_abandon', cachedAt: 1, blob: new Blob(['x']) });

    expect(await db.meta.get('dataVersion')).toMatchObject({ value: '2026.10.01' });
    expect(await db.audioCache.get('tts://w_abandon')).toMatchObject({ cachedAt: 1 });
  });

  /**
   * ★ 分离原则的核心断言：清空镜像区时，用户进度一分不丢。
   * 这正是「换数据源 / 词库升级不伤用户进度」的机制保障。
   */
  it('清镜像区不动用户进度区', async () => {
    await db.words.put(makeWord('w_abandon', 1));
    await db.cards.put({
      wordId: 'w_abandon',
      due: 1,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      suspended: false,
      createdAt: 1,
      introsRank: 1,
    });

    const cleared = await clearMirror(db);

    expect(cleared).toEqual([...MIRROR_STORES]);
    expect(await db.words.count()).toBe(0);
    expect(await db.cards.count()).toBe(1);
  });
});
