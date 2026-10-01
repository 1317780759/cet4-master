import { describe, expect, it } from 'vitest';
import type { AnswerRecord, ExamQuestion } from './types';
import { gradeObjective, isObjectiveQuestion, objectiveRate } from './grader';

/**
 * gradeObjective 单测 —— 重点是 **B6（docs/04 §4.3）**：
 * 存疑错题**绝不能**流进错题本 / FSRS。
 * 数据源无官方底本可核对，一条错误的标准答案会永久污染复习调度。
 */

function q(id: string, answer: string, extra: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    id,
    paperId: 'P',
    sectionId: 'P:R-A',
    kind: 'choice',
    no: 1,
    score: 2,
    answer,
    ...extra,
  };
}

function rec(answer: string | null, extra: Partial<AnswerRecord> = {}): AnswerRecord {
  return { questionId: 'ignored', value: answer, flag: answer == null ? 'unanswered' : 'answered', ...extra };
}

/** 10 道客观题，标准答案依次为 A/B/C... */
function sampleQuestions(): ExamQuestion[] {
  return Array.from({ length: 10 }, (_, i) =>
    q(`Q${i}`, ['A', 'B', 'C', 'D'][i % 4]!, { no: i + 1 }),
  );
}

describe('gradeObjective · 基本批改', () => {
  it('全对 → 计 correct，不产生错题', () => {
    const qs = sampleQuestions();
    const answers: Record<string, AnswerRecord> = {};
    qs.forEach((x) => (answers[x.id] = rec(x.answer!)));
    const out = gradeObjective({ questions: qs, answers });

    expect(out.objectiveTotal).toBe(10);
    expect(out.objectiveCorrect).toBe(10);
    expect(out.wrongQuestionIds).toEqual([]);
    expect(objectiveRate(out)).toBe(1);
  });

  it('答错 → wrong 且进入 wrongQuestionIds', () => {
    const qs = sampleQuestions();
    const answers: Record<string, AnswerRecord> = {
      Q0: rec('A'), // 正确
      Q1: rec('A'), // 错误（标准答案 B）
    };
    const out = gradeObjective({ questions: qs, answers });
    expect(out.outcomes['Q0']).toBe('correct');
    expect(out.outcomes['Q1']).toBe('wrong');
    expect(out.wrongQuestionIds).toEqual(['Q1']);
    expect(out.objectiveCorrect).toBe(1);
  });

  it('未作答 / 空串 → blank，不算错题、也不占分子', () => {
    const qs = sampleQuestions();
    const out = gradeObjective({ questions: qs, answers: { Q0: rec(null), Q1: rec('   ') } });
    expect(out.outcomes['Q0']).toBe('blank');
    expect(out.outcomes['Q1']).toBe('blank');
    expect(out.wrongQuestionIds).toEqual([]);
    expect(out.objectiveCorrect).toBe(0);
  });

  it('缺记录视为未作答，不抛错', () => {
    const out = gradeObjective({ questions: sampleQuestions(), answers: {} });
    expect(out.objectiveTotal).toBe(10);
    expect(out.wrongQuestionIds).toEqual([]);
    expect(Object.values(out.outcomes).every((o) => o === 'blank')).toBe(true);
  });

  it('答案比较：忽略大小写与首尾空格', () => {
    const qs = [q('Q0', 'B')];
    expect(gradeObjective({ questions: qs, answers: { Q0: rec('b') } }).outcomes['Q0']).toBe('correct');
    expect(gradeObjective({ questions: qs, answers: { Q0: rec('  B  ') } }).outcomes['Q0']).toBe('correct');
  });

  it('主观题（无标准答案）不计入客观题总数', () => {
    const qs = [q('Q0', 'A'), q('E1', '', { kind: 'essay' }), q('T1', '', { kind: 'translation' })];
    const out = gradeObjective({ questions: qs, answers: { Q0: rec('A') } });
    expect(out.objectiveTotal).toBe(1);
    expect(out.outcomes['E1']).toBeUndefined();
    expect(out.outcomes['T1']).toBeUndefined();
  });
});

describe('★ B6 · 存疑题分流（不得进入错题本 / FSRS）', () => {
  it('存疑 + 答错 → doubtful，不进 wrongQuestionIds，但仍占分母', () => {
    const qs = [q('Q0', 'B')];
    const out = gradeObjective({ questions: qs, answers: { Q0: rec('A', { doubtful: true }) } });

    expect(out.outcomes['Q0']).toBe('doubtful');
    expect(out.wrongQuestionIds).toEqual([]); // ★ 关键断言
    expect(out.doubtfulProblemIds).toEqual(['Q0']);
    expect(out.objectiveTotal).toBe(1); // 分母不打折
    expect(out.objectiveCorrect).toBe(0);
  });

  it('存疑优先：即便答对也判 doubtful（不占分子）', () => {
    const qs = [q('Q0', 'B')];
    const out = gradeObjective({ questions: qs, answers: { Q0: rec('B', { doubtful: true }) } });
    expect(out.outcomes['Q0']).toBe('doubtful');
    expect(out.objectiveCorrect).toBe(0);
    expect(out.doubtfulProblemIds).toEqual(['Q0']);
  });

  it('互斥性：wrongQuestionIds 与 doubtfulProblemIds 永不相交', () => {
    const qs = sampleQuestions();
    const answers: Record<string, AnswerRecord> = {};
    qs.forEach((x, i) => {
      answers[x.id] = rec(i % 3 === 0 ? x.answer! : 'Z', { doubtful: i % 2 === 0 });
    });
    const out = gradeObjective({ questions: qs, answers });

    const overlap = out.wrongQuestionIds.filter((id) => out.doubtfulProblemIds.includes(id));
    expect(overlap).toEqual([]);
    expect(out.doubtfulProblemIds).toEqual(['Q0', 'Q2', 'Q4', 'Q6', 'Q8']);
    expect(out.wrongQuestionIds).toEqual(['Q1', 'Q5', 'Q7']);
  });
});

describe('gradeObjective · marked（标记待定）语义', () => {
  it('答对 + 标记 → marked，计入分子但不回流', () => {
    const qs = [q('Q0', 'B')];
    const out = gradeObjective({ questions: qs, answers: { Q0: rec('B', { flag: 'marked' }) } });
    expect(out.outcomes['Q0']).toBe('marked');
    expect(out.objectiveCorrect).toBe(1);
    expect(out.wrongQuestionIds).toEqual([]);
  });

  it('答错 + 标记 → 仍判 wrong（错题必须回流，标记只是考试中的书签）', () => {
    const qs = [q('Q0', 'B')];
    const out = gradeObjective({ questions: qs, answers: { Q0: rec('A', { flag: 'marked' }) } });
    expect(out.outcomes['Q0']).toBe('wrong');
    expect(out.wrongQuestionIds).toEqual(['Q0']);
  });
});

describe('objectiveRate', () => {
  it('分母为 0 返回 null，而不是 0%（docs/04 §9 约定 #6）', () => {
    expect(objectiveRate({ outcomes: {}, objectiveCorrect: 0, objectiveTotal: 0, wrongQuestionIds: [], doubtfulProblemIds: [] })).toBeNull();
  });
  it('正常返回比例', () => {
    expect(objectiveRate({ outcomes: {}, objectiveCorrect: 7, objectiveTotal: 10, wrongQuestionIds: [], doubtfulProblemIds: [] })).toBeCloseTo(0.7);
  });
});

describe('isObjectiveQuestion', () => {
  it('按有无标准答案 + 题型判定', () => {
    expect(isObjectiveQuestion(q('Q', 'A'))).toBe(true);
    expect(isObjectiveQuestion(q('E', '', { kind: 'essay' }))).toBe(false);
    expect(isObjectiveQuestion(q('T', '', { kind: 'translation' }))).toBe(false);
  });
});
