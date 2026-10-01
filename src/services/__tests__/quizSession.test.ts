import { beforeEach, describe, expect, it } from 'vitest';
import type { Cet4Database } from '@/data/db/db';
import type { Tier, Word } from '@/domain/word/types';
import { generateQuiz } from '@/domain/quiz/generator';
import { listWrong } from '@/data/repos/wrongRepo';
import {
  finishQuizSession,
  gradeQuiz,
  recycleQuizWrong,
  startQuizSession,
} from '@/services/quizSession';
import { freshDb } from './examFixture';

/**
 * 测验会话单测。
 *
 * ★ 有一条**刻意与真题相反**的断言：测验没有"存疑"分流。
 *   测验答案来自词库自带释义（可信），答错就该进错题本；
 *   若把真题的 B6 逻辑误套过来，用户会永远练不到自己真正错的词。
 */

const NOW = 1_700_000_000_000;

function makeWord(headword: string, zh: string, rank: number, tier: Tier = 'cet4'): Word {
  return {
    id: `w_${headword}`,
    headword,
    variants: [],
    senses: [{ pos: 'unknown', zh }],
    freqRank: rank,
    freqCount: 40,
    tier,
    chunk: 1,
    sentenceCount: 0,
    source: 'exam-data/CETVocabulary@test',
    license: 'CC BY-NC-SA 4.0',
  };
}

const WORDS: Word[] = Array.from({ length: 10 }, (_, i) => makeWord(`qw${i}`, `意思${i}`, i + 1));

let db: Cet4Database;
let questions: ReturnType<typeof generateQuiz>;

beforeEach(() => {
  db = freshDb('quiz');
  questions = generateQuiz({ words: WORDS, count: 5, seed: 77 });
});

describe('gradeQuiz · 判分', () => {
  it('全对：correct = total，无错题回流', () => {
    const answers = Object.fromEntries(
      questions.map((q) => [q.id, { questionId: q.id, selectedKey: q.answerKey }]),
    );
    const result = gradeQuiz(questions, answers);
    expect(result.correct).toBe(questions.length);
    expect(result.total).toBe(questions.length);
    expect(result.wrongWordIds).toEqual([]);
  });

  it('答错 → wrong 且被考词进入回流名单', () => {
    const first = questions[0]!;
    const wrongKey = first.options.find((o) => o.key !== first.answerKey)!.key;
    // 其余题目全部答对，才能断言"只错了这一道"
    const answers = Object.fromEntries(
      questions.map((q) => [q.id, { questionId: q.id, selectedKey: q.answerKey }]),
    );
    answers[first.id] = { questionId: first.id, selectedKey: wrongKey };

    const result = gradeQuiz(questions, answers);
    expect(result.outcomes[first.id]).toBe('wrong');
    expect(result.wrongWordIds).toContain(first.wordId);
    expect(result.correct).toBe(questions.length - 1);
  });

  it('★ 未作答也算"没掌握"，同样回流（未答同样暴露记忆缺口）', () => {
    const first = questions[0]!;
    const result = gradeQuiz(questions, {});
    expect(result.outcomes[first.id]).toBe('blank');
    expect(result.wrongWordIds).toContain(first.wordId);
  });

  it('同一词在两题里出现时，回流名单去重', () => {
    const dup = [questions[0]!, questions[0]!];
    const result = gradeQuiz(dup, {});
    expect(result.wrongWordIds.filter((id) => id === questions[0]!.wordId)).toHaveLength(1);
  });
});

describe('测验会话记录', () => {
  it('开场 → 结束，落库 startedAt / finishedAt / correct / total', async () => {
    const id = await startQuizSession('choice', db, NOW);
    await finishQuizSession(id, { correct: 4, total: 5 }, db, NOW + 60_000);

    const row = await db.quizSessions.get(id);
    expect(row?.type).toBe('choice');
    expect(row?.startedAt).toBe(NOW);
    expect(row?.finishedAt).toBe(NOW + 60_000);
    expect(row?.correct).toBe(4);
    expect(row?.total).toBe(5);
  });

  it('结束一个不存在的会话不抛错（幂等容错）', async () => {
    await expect(finishQuizSession(9999, { correct: 0, total: 0 }, db, NOW)).resolves.toBeUndefined();
  });
});

describe('recycleQuizWrong · 错题回流', () => {
  it('★ 测验答错一律入错题本（没有"存疑"分流 —— 答案来自可信词库）', async () => {
    const report = await recycleQuizWrong(['w_a', 'w_b'], db, NOW);
    expect(report.added).toBe(2);

    const rows = await listWrong({}, db);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'quiz' && r.enqueued)).toBe(true);
  });

  it('同一词重复错 → 只累加频次，不重复插入', async () => {
    await recycleQuizWrong(['w_a'], db, NOW);
    const second = await recycleQuizWrong(['w_a'], db, NOW + 1000);

    expect(second.added).toBe(0);
    expect(second.updated).toBe(1);
    const rows = await listWrong({}, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.wrongCount).toBe(2);
  });
});
