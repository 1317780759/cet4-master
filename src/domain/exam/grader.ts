/**
 * 客观题批改 —— 纯函数（铁律 A1：零 React、零 IO、零 Date）。
 *
 * ★ 本期最硬的一条规则 **B6（docs/04 §4.3）**：
 *   数据源不可验证（无官方底本），**错误的标准答案若被当作错题送进 FSRS，
 *   会永久污染复习调度** —— 比答案本身错更严重。
 *   因此「存疑不入队」必须在 **grader 层**就分流，
 *   **不得依赖 UI 层过滤**（UI 可能被绕过、可能忘 feature flag）。
 *
 * 由此确定两条互斥保证：
 *   - `wrongQuestionIds` ∩ `doubtfulProblemIds` = ∅
 *   - 存疑题**仍计入** `objectiveTotal` 分母（既不进 FWRS，也不允许偷偷拉高正确率）
 */

import type { AnswerRecord, ExamQuestion } from './types';

/**
 * 批改结果状态。
 *
 * 优先级（先命中者胜）：`doubtful` > `blank` > `wrong` > `marked` > `correct`。
 * ⚠️ `marked` 只在**答对但仍标记待定**时出现 —— 表示"用户对了但想回看"，
 *    不参与错题回流；**答错且标记**仍判 `wrong`（错题必须回流，标记只是考试中的书签）。
 */
export type ObjectiveOutcome = 'correct' | 'wrong' | 'blank' | 'marked' | 'doubtful';

export interface GradeInput {
  questions: readonly ExamQuestion[];
  /** key = questionId */
  answers: Record<string, AnswerRecord>;
}

export interface GradeOutput {
  /** key = questionId（**仅客观题**；主观题不进入 outcomes） */
  outcomes: Record<string, ObjectiveOutcome>;
  /** 客观题答对题数 */
  objectiveCorrect: number;
  /** 客观题总题数（含空白与存疑 —— 分母不打折） */
  objectiveTotal: number;
  /** 错题本候选（★ 已排除 doubtful） */
  wrongQuestionIds: string[];
  /** 存疑错题 → 待核对列表，不入 FSRS */
  doubtfulProblemIds: string[];
}

/** 客观题 = 有标准答案且非主观题型的题 */
export function isObjectiveQuestion(q: ExamQuestion): boolean {
  return q.answer !== undefined && q.kind !== 'essay' && q.kind !== 'translation';
}

/** 答案规范化：去首尾空白 + 忽略大小写（兼容 'B' / 'b' / 'banked:E3' / 'I'） */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 客观题自动批改。
 *
 * 注意：`answers` 里没有记录的题 == 未作答（blank），**不会**抛错。
 */
export function gradeObjective(input: GradeInput): GradeOutput {
  const { questions, answers } = input;

  const outcomes: Record<string, ObjectiveOutcome> = {};
  const wrongQuestionIds: string[] = [];
  const doubtfulProblemIds: string[] = [];
  let objectiveCorrect = 0;
  let objectiveTotal = 0;

  for (const q of questions) {
    if (!isObjectiveQuestion(q)) continue; // 主观题不参与客观批改

    objectiveTotal += 1;
    const record = answers[q.id];
    const raw = record?.value;

    if (record?.doubtful) {
      // ★ B6：存疑优先 —— 无论对错都不进错题本，且仍占分母
      outcomes[q.id] = 'doubtful';
      doubtfulProblemIds.push(q.id);
      continue;
    }

    if (raw === null || raw === undefined || normalize(raw) === '') {
      outcomes[q.id] = 'blank';
      continue;
    }

    const isCorrect = normalize(raw) === normalize(q.answer!);

    if (!isCorrect) {
      outcomes[q.id] = 'wrong';
      wrongQuestionIds.push(q.id);
      continue;
    }

    // 答对：仍标记待定 → 'marked'（回看提示）；否则 'correct'。
    // ⚠️ 两者都**计入分子** —— 标记只是考试中的书签，答对就是答对，不能偷偷压低正确率。
    outcomes[q.id] = record?.flag === 'marked' ? 'marked' : 'correct';
    objectiveCorrect += 1;
  }

  return { outcomes, objectiveCorrect, objectiveTotal, wrongQuestionIds, doubtfulProblemIds };
}

/**
 * 正确率 —— ★ 分母为 0 时返回 `null`（docs/04 §9 约定 #6：UI 显示"无样本"，禁止产出 0%）。
 */
export function objectiveRate(grade: GradeOutput): number | null {
  return grade.objectiveTotal === 0 ? null : grade.objectiveCorrect / grade.objectiveTotal;
}
