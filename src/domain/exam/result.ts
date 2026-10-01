/**
 * 结果页视图模型 —— 纯函数派生（铁律 A1：零 React、零 IO、零 Date）。
 *
 * ★ 两条不可协商的产品口径（docs/03 / docs/04 第 4 章）：
 *   1. **零总分、零分数换算** —— 结果页没有"总分"这一个字段可填（接口层面不给），
 *      自然也就不会被误读为计分结果。这是"结构性防呆"，不只是文案提醒。
 *   2. **板块明细由 `plan.slots` 驱动**（K1） —— 恢复听力后结果页自动多一张卡，零代码改动。
 *
 * 本文件同时是 T5-v2 / T7 / T11 文案的**唯一出处**，UI 不得另抄一份
 * （抄了就会漂移，且"翻译 Results 时改口径"这类事故无法被门禁发现）。
 */

import type { ExamAttempt, ExamQuestion, ExamSectionKind } from './types';
import type { GradeOutput, ObjectiveOutcome } from './grader';
import { isObjectiveQuestion } from './grader';
import type { SectionPlan } from './sectionPlan';

/** 第 1 层：总述（零总分、零换算） */
export interface ResultOverview {
  answered: number;
  /** 启用板块题数之和（由 plan.slots 求和，K3） */
  total: number;
  objectiveCorrect: number;
  objectiveTotal: number;
  /** ⚠️ 分母为 0 时为 null，UI 显示"无样本"，**禁止产出 0%**（docs/04 §9 约定 #6） */
  objectiveRate: number | null;
  elapsedSec: number;
}

/** 第 2 层：板块明细卡 */
export type SectionResultCard =
  | {
      kind: 'objective';
      sectionKind: ExamSectionKind;
      label: string;
      correct: number;
      total: number;
      rate: number | null;
    }
  | {
      kind: 'subjective';
      sectionKind: ExamSectionKind;
      label: string;
      /** 未自评时 null → UI 显示"未自评"，**不参与任何统计**（docs/04 §4.3 B5） */
      selfScore: number | null;
      rubricRef?: string;
    }
  | {
      kind: 'disabled';
      sectionKind: ExamSectionKind;
      label: string;
      note: string;
    };

/** 第 3 层：免责与缺失声明 —— UI 的唯一出处 */
export interface ResultDisclaimers {
  /** T5-v2（docs/04 §5.6 裁决版，**无 425/710 数字**） */
  resultCopyright: string;
  /** T11：听力停用占位说明 */
  listeningDisabled: string;
  /** T7：客观题口径说明 */
  objectiveOnlyNote: string;
}

export interface ExamResultView {
  paperId: string;
  overview: ResultOverview;
  sections: SectionResultCard[];
  disclaimers: ResultDisclaimers;
  recycled: { wrongCount: number; newWordCount: number };
}

/**
 * ★ 免责文案唯一出处。
 * 改动这些字符串前请先读 `docs/04 §5.6` —— 它们同时受 `scripts/forbidden-words.ts` 门禁约束。
 */
export const DISCLAIMER_TEXT = {
  /** T5-v2：去 425/710 数字版（不改语义，只去数字） */
  resultCopyright:
    '本卷为第三方整理版，答案未经官方核对。成绩仅供练习参考，不代表真实四级水平，也不与任何官方计分口径对应。',
  /** T11 */
  listeningDisabled: '本次练习未启用听力，故不产出听说类得分。',
  /** T7 */
  objectiveOnlyNote: '自动批改仅覆盖客观题；写作与翻译为自评，不计入任何成绩换算。',
} as const;

const SUBJECTIVE_SELF_SCORE_KEY: Partial<Record<ExamSectionKind, 'writing' | 'translation'>> = {
  writing: 'writing',
  translation: 'translation',
};

export interface DeriveResultInput {
  attempt: ExamAttempt;
  plan: SectionPlan;
  /** grader 产物 */
  grade: GradeOutput;
  /** 启用板块范围内的题（用于判定板块是客观还是主观） */
  questions: readonly ExamQuestion[];
}

function rate(correct: number, total: number): number | null {
  return total === 0 ? null : correct / total;
}

/**
 * 派生结果页视图模型。
 *
 * 注意：**刻意不产出任何总分字段** —— 想要"总分"的人会在类型层就撞墙。
 */
export function deriveResultView(input: DeriveResultInput): ExamResultView {
  const { attempt, plan, grade, questions } = input;

  const total = plan.slots.reduce((s, x) => s + x.questionCount, 0);
  const answered = Object.values(grade.outcomes).filter(
    (o: ObjectiveOutcome) => o !== 'blank',
  ).length;

  const selfScores = attempt.subjectiveSelfScore ?? {};

  const enabledCards: SectionResultCard[] = plan.slots.map((slot) => {
    const sectionKind = slot.meta.kind;
    const label = slot.meta.partLabel;
    const slotQuestions = questions.filter(
      (x) => x.no >= slot.questionFrom && x.no <= slot.questionTo,
    );
    const objectiveQs = slotQuestions.filter(isObjectiveQuestion);

    // 板块内含客观题 → 客观卡；否则视为主观卡（K1：不按 sectionKind 硬编码）
    if (objectiveQs.length > 0) {
      const correct = objectiveQs.filter((x) => grade.outcomes[x.id] === 'correct').length;
      const total_ = objectiveQs.length;
      return {
        kind: 'objective',
        sectionKind,
        label,
        correct,
        total: total_,
        rate: rate(correct, total_),
      } satisfies SectionResultCard;
    }

    const key = SUBJECTIVE_SELF_SCORE_KEY[sectionKind];
    return {
      kind: 'subjective',
      sectionKind,
      label,
      selfScore: key ? (selfScores[key] ?? null) : null,
    } satisfies SectionResultCard;
  });

  // Q5 决策：结果页显示停用板块占位卡（而非彻底隐藏）
  const disabledCards: SectionResultCard[] = plan.disabledKinds.map((kind) => ({
    kind: 'disabled',
    sectionKind: kind,
    label: 'Part II Listening',
    note: '本期未启用',
  }));

  return {
    paperId: attempt.paperId,
    overview: {
      answered,
      total,
      objectiveCorrect: grade.objectiveCorrect,
      objectiveTotal: grade.objectiveTotal,
      objectiveRate: rate(grade.objectiveCorrect, grade.objectiveTotal),
      elapsedSec: attempt.elapsedSec,
    },
    sections: [...enabledCards, ...disabledCards],
    disclaimers: {
      resultCopyright: DISCLAIMER_TEXT.resultCopyright,
      listeningDisabled: DISCLAIMER_TEXT.listeningDisabled,
      objectiveOnlyNote: DISCLAIMER_TEXT.objectiveOnlyNote,
    },
    recycled: {
      wrongCount: attempt.wrongQuestionIds.length,
      newWordCount: attempt.newWordIds.length,
    },
  };
}
