import { describe, expect, it } from 'vitest';
import type { AnswerRecord, ExamAttempt, ExamQuestion, ExamSectionMeta } from './types';
import { buildSectionPlan } from './sectionPlan';
import { gradeObjective } from './grader';
import { DISCLAIMER_TEXT, deriveResultView } from './result';

/**
 * deriveResultView 单测 —— 验收两条不可协商口径：
 *   1. **零总分、零 425/710**（docs/04 附录 B-Q5）
 *   2. **板块明细由 plan.slots 驱动**（K1），听力恢复后结果页自动多一张卡
 */

const SECTION_META: ExamSectionMeta[] = [
  { id: 'P:W', kind: 'writing', order: 1, partLabel: 'Part I Writing', questionFrom: 1, questionTo: 1, durationHintSec: 1800, rawScore: 106.5 },
  { id: 'P:L', kind: 'listening', order: 2, partLabel: 'Part II Listening', questionFrom: 2, questionTo: 26, durationHintSec: 1500, rawScore: 248.5 },
  { id: 'P:R', kind: 'reading', order: 3, partLabel: 'Part III Reading', questionFrom: 27, questionTo: 56, durationHintSec: 2400, rawScore: 248.5 },
  { id: 'P:T', kind: 'translation', order: 4, partLabel: 'Part IV Translation', questionFrom: 57, questionTo: 57, durationHintSec: 1800, rawScore: 106.5 },
];

function makeQuestions(): ExamQuestion[] {
  const qs: ExamQuestion[] = [
    { id: 'E1', paperId: 'P', sectionId: 'P:W', kind: 'essay', no: 1, score: 106.5, rubric: '切题、结构、语言' },
  ];
  for (let i = 0; i < 5; i += 1) {
    qs.push({
      id: `R${i}`,
      paperId: 'P',
      sectionId: 'P:R',
      kind: 'choice',
      no: 27 + i,
      score: 2,
      answer: 'B',
      stem: undefined,
    });
  }
  qs.push({ id: 'T1', paperId: 'P', sectionId: 'P:T', kind: 'translation', no: 57, score: 106.5, rubric: '忠实、通顺' });
  return qs;
}

function makeAttempt(over: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: 'A1',
    paperId: 'P',
    mode: 'mock',
    status: 'submitted',
    startedAt: 0,
    elapsedSec: 3600,
    objectiveScore: 0,
    objectiveTotal: 0,
    sectionScores: [],
    scoreScaleNote: 'objective-only',
    wrongQuestionIds: [],
    newWordIds: [],
    ...over,
  };
}

function makeAnswers(correctCount: number): Record<string, AnswerRecord> {
  const answers: Record<string, AnswerRecord> = {};
  for (let i = 0; i < 5; i += 1) {
    answers[`R${i}`] = {
      questionId: `R${i}`,
      value: i < correctCount ? 'B' : 'A',
      flag: 'answered',
    };
  }
  return answers;
}

const paper = {
  id: 'P',
  year: 2026,
  month: 6 as const,
  setNo: 1,
  level: 'CET4' as const,
  durationMin: 125,
  totalScore: 710,
  sectionMeta: SECTION_META,
  provenance: 'derived' as const,
  provenanceLabel: '同源模拟卷',
  confidence: {
    level: 'medium' as const,
    hasTranscript: false,
    hasAudio: false,
    hasExplanation: true,
    answerCrossChecked: false,
    spotCheckRatio: 0.1,
    doubtCount: 0,
  },
};

describe('deriveResultView · 总述', () => {
  it('已作答数 / 客观正确率 / 用时', () => {
    const plan = buildSectionPlan(paper);
    const grade = gradeObjective({ questions: makeQuestions(), answers: makeAnswers(3) });
    const view = deriveResultView({ attempt: makeAttempt(), plan, grade, questions: makeQuestions() });

    expect(view.overview.answered).toBe(5);
    expect(view.overview.objectiveCorrect).toBe(3);
    expect(view.overview.objectiveTotal).toBe(5);
    expect(view.overview.objectiveRate).toBeCloseTo(0.6);
    expect(view.overview.elapsedSec).toBe(3600);
    // total 由 plan.slots 求和（启用板块：写作1 + 阅读30 + 翻译1 = 32）
    expect(view.overview.total).toBe(plan.slots.reduce((s, x) => s + x.questionCount, 0));
  });

  it('★ 零换算：整个视图序列化后不含任何 425 / 710 字样（附录 B-Q5）', () => {
    const plan = buildSectionPlan(paper);
    const grade = gradeObjective({ questions: makeQuestions(), answers: makeAnswers(5) });
    const view = deriveResultView({
      attempt: makeAttempt({ wrongQuestionIds: ['R0'], newWordIds: ['w1'] }),
      plan,
      grade,
      questions: makeQuestions(),
    });

    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/425/);
    expect(serialized).not.toMatch(/710/);
    // 且结构上就不存在"总分"字段可供填充
    expect('totalScore' in view).toBe(false);
    expect('totalScore' in view.overview).toBe(false);
  });

  it('客观题分母为 0 → objectiveRate 为 null（不产出 0%）', () => {
    const plan = buildSectionPlan(paper);
    const grade = gradeObjective({ questions: [], answers: {} });
    const view = deriveResultView({ attempt: makeAttempt(), plan, grade, questions: [] });
    expect(view.overview.objectiveTotal).toBe(0);
    expect(view.overview.objectiveRate).toBeNull();
  });
});

describe('deriveResultView · 板块明细（K1：由 plan.slots 驱动）', () => {
  it('阅读 → 客观卡；写作/翻译 → 主观卡；标签取自 partLabel', () => {
    const plan = buildSectionPlan(paper);
    const questions = makeQuestions();
    const grade = gradeObjective({ questions, answers: makeAnswers(4) });
    const view = deriveResultView({ attempt: makeAttempt(), plan, grade, questions });

    expect(view.sections.map((s) => s.label)).toEqual([
      'Part I Writing',
      'Part III Reading',
      'Part IV Translation',
      'Part II Listening',
    ]);

    const reading = view.sections.find((s) => s.label === 'Part III Reading');
    expect(reading?.kind).toBe('objective');
    if (reading?.kind === 'objective') {
      expect(reading.correct).toBe(4);
      expect(reading.total).toBe(5);
      expect(reading.rate).toBeCloseTo(0.8);
    }

    const writing = view.sections.find((s) => s.label === 'Part I Writing');
    expect(writing?.kind).toBe('subjective');
  });

  it('未自评 → selfScore 为 null，且不影响任何统计（B5）', () => {
    const plan = buildSectionPlan(paper);
    const view = deriveResultView({
      attempt: makeAttempt(),
      plan,
      grade: gradeObjective({ questions: makeQuestions(), answers: makeAnswers(5) }),
      questions: makeQuestions(),
    });
    const writing = view.sections.find((s) => s.label === 'Part I Writing');
    if (writing?.kind === 'subjective') expect(writing.selfScore).toBeNull();
  });

  it('自评后读取 PCM 分档值', () => {
    const plan = buildSectionPlan(paper);
    const view = deriveResultView({
      attempt: makeAttempt({ subjectiveSelfScore: { writing: 3, translation: 2 } }),
      plan,
      grade: gradeObjective({ questions: makeQuestions(), answers: makeAnswers(5) }),
      questions: makeQuestions(),
    });
    const writing = view.sections.find((s) => s.label === 'Part I Writing');
    if (writing?.kind === 'subjective') expect(writing.selfScore).toBe(3);
  });

  it('★ 听力停用 → 出现占位卡（Q5 决策：显示而非隐藏）', () => {
    const plan = buildSectionPlan(paper);
    const view = deriveResultView({
      attempt: makeAttempt(),
      plan,
      grade: gradeObjective({ questions: makeQuestions(), answers: makeAnswers(5) }),
      questions: makeQuestions(),
    });
    const listeningCard = view.sections.find((s) => s.sectionKind === 'listening');
    expect(listeningCard?.kind).toBe('disabled');
    expect(view.disclaimers.listeningDisabled).toBe(DISCLAIMER_TEXT.listeningDisabled);
  });

  it('★ 恢复听力后占位卡自动消失（零代码改动）', () => {
    const planRestored = buildSectionPlan(paper, []);
    const view = deriveResultView({
      attempt: makeAttempt(),
      plan: planRestored,
      grade: gradeObjective({ questions: makeQuestions(), answers: makeAnswers(5) }),
      questions: makeQuestions(),
    });
    expect(view.sections.some((s) => s.kind === 'disabled')).toBe(false);
    expect(view.sections).toHaveLength(planRestored.slots.length);
    expect(view.sections.map((s) => s.sectionKind)).toEqual(['writing', 'listening', 'reading', 'translation']);
  });
});

describe('deriveResultView · 回流统计与免责', () => {
  it('wrongCount / newWordCount 取自 attempt', () => {
    const plan = buildSectionPlan(paper);
    const view = deriveResultView({
      attempt: makeAttempt({ wrongQuestionIds: ['R0', 'R1'], newWordIds: ['w1', 'w2', 'w3'] }),
      plan,
      grade: gradeObjective({ questions: makeQuestions(), answers: makeAnswers(3) }),
      questions: makeQuestions(),
    });
    expect(view.recycled).toEqual({ wrongCount: 2, newWordCount: 3 });
  });

  it('三层免责文案齐备，且与 docs/03 定版一致', () => {
    const plan = buildSectionPlan(paper);
    const view = deriveResultView({
      attempt: makeAttempt(),
      plan,
      grade: gradeObjective({ questions: makeQuestions(), answers: makeAnswers(5) }),
      questions: makeQuestions(),
    });
    expect(view.disclaimers.resultCopyright).toBe(
      '本卷为第三方整理版，答案未经官方核对。成绩仅供练习参考，不代表真实四级水平，也不与任何官方计分口径对应。',
    );
    expect(view.disclaimers.objectiveOnlyNote).toBe(DISCLAIMER_TEXT.objectiveOnlyNote);
  });
});
