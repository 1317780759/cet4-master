import { beforeEach, describe, expect, it } from 'vitest';
import type { Cet4Database } from '@/data/db/db';
import { countVocab } from '@/data/repos/vocabRepo';
import { listWrong } from '@/data/repos/wrongRepo';
import { recycleAttempt } from '@/services/examRecycle';
import { freshDb, PAPER_ID } from './examFixture';

/**
 * 回流单测 —— 重点仍是 **B6**：存疑题绝不能进错题本 / FSRS。
 * 本文件专门验证「即便调用方把存疑题混进 wrongQuestionIds，本函数也会拦下」这一纵深防御。
 */

const NOW = 1_700_000_000_000;

let db: Cet4Database;

beforeEach(() => {
  db = freshDb('recycle');
});

describe('recycleAttempt · 错题入队', () => {
  it('新增错题：wrongCount=1、enqueued=true、立即到期', async () => {
    const report = await recycleAttempt(
      { attemptId: 'A1', paperId: PAPER_ID, wrongQuestionIds: ['R0', 'R1'], now: NOW },
      db,
    );

    expect(report.wrongAdded).toBe(2);
    expect(report.wrongUpdated).toBe(0);
    expect(report.acceptedQuestionIds).toEqual(['R0', 'R1']);

    const rows = await listWrong({}, db);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.enqueued && r.wrongCount === 1 && r.nextDue === NOW)).toBe(true);
  });

  it('同一题再次答错 → 只累加频次，不重复插入', async () => {
    await recycleAttempt({ attemptId: 'A1', paperId: PAPER_ID, wrongQuestionIds: ['R0'], now: NOW }, db);
    const report = await recycleAttempt(
      { attemptId: 'A2', paperId: PAPER_ID, wrongQuestionIds: ['R0'], now: NOW + 1000 },
      db,
    );

    expect(report.wrongAdded).toBe(0);
    expect(report.wrongUpdated).toBe(1);

    const rows = await listWrong({}, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.wrongCount).toBe(2);
    expect(rows[0]!.lastWrongAt).toBe(NOW + 1000);
  });
});

describe('★ B6 · 存疑题纵深防御', () => {
  it('即便调用方把存疑题混进 wrongQuestionIds，也一律拦下且不计入错题本', async () => {
    const report = await recycleAttempt(
      {
        attemptId: 'A1',
        paperId: PAPER_ID,
        wrongQuestionIds: ['R0', 'R1', 'R2'],
        doubtfulQuestionIds: ['R1', 'R2'],
        now: NOW,
      },
      db,
    );

    expect(report.acceptedQuestionIds).toEqual(['R0']);
    expect(report.doubtfulRejected).toBe(2);

    const rows = await listWrong({}, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.questionId).toBe('R0');
    // 存疑题既不在错题本里，也不能被静默丢弃（数量要对得上，便于上层报警）
    expect(report.wrongAdded).toBe(1);
  });

  it('clean 路径下 doubtfulRejected 应为 0（>0 说明 grader 契约被破坏）', async () => {
    const report = await recycleAttempt(
      {
        attemptId: 'A1',
        paperId: PAPER_ID,
        wrongQuestionIds: ['R0'],
        doubtfulQuestionIds: ['R9'],
        now: NOW,
      },
      db,
    );
    expect(report.doubtfulRejected).toBe(0);
  });
});

describe('recycleAttempt · 生词回流', () => {
  it('从**已确认错题**的 keyWordHints 提取生词，带 origin 溯源', async () => {
    const report = await recycleAttempt(
      {
        attemptId: 'A1',
        paperId: PAPER_ID,
        wrongQuestionIds: ['R0'],
        wordHintsByQuestion: { R0: ['w_alpha'], R1: ['w_beta'] },
        now: NOW,
      },
      db,
    );

    expect(report.vocabAdded).toBe(1);
    expect(await countVocab(db)).toBe(1);
    // R1 不在错题集合里 → 它的生词不应被带入
  });

  it('存疑题的生词同样不回流（与错题同一口径）', async () => {
    await recycleAttempt(
      {
        attemptId: 'A1',
        paperId: PAPER_ID,
        wrongQuestionIds: ['R0'],
        doubtfulQuestionIds: ['R0'],
        wordHintsByQuestion: { R0: ['w_alpha'] },
        now: NOW,
      },
      db,
    );
    expect(await countVocab(db)).toBe(0);
  });

  it('生词本幂等：重复导入同一词不会重复计数', async () => {
    const input = {
      attemptId: 'A1',
      paperId: PAPER_ID,
      wrongQuestionIds: ['R0'],
      wordHintsByQuestion: { R0: ['w_alpha'] },
      now: NOW,
    };
    await recycleAttempt(input, db);
    const second = await recycleAttempt(input, db);
    expect(second.vocabAdded).toBe(0);
    expect(await countVocab(db)).toBe(1);
  });
});
