import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import { getPaper, listQuestions } from '@/data/repos/paperRepo';
import { uid } from '@/lib/id';
import { buildSectionPlan, questionsInPlan, type SectionPlan } from '@/domain/exam/sectionPlan';
import { gradeObjective, type GradeOutput } from '@/domain/exam/grader';
import { deriveResultView, type ExamResultView } from '@/domain/exam/result';
import type {
  AnswerRecord,
  AnswerSheet,
  AttemptMode,
  ExamAttempt,
  ExamQuestion,
  QuestionFlag,
} from '@/domain/exam/types';
import { recycleAttempt, type RecycleReport } from './examRecycle';

/** 存疑原因 —— 从 AnswerRecord 派生，避免与领域类型二次定义产生漂移 */
export type DoubtReason = NonNullable<AnswerRecord['doubtReason']>;

/**
 * 真题练习会话 —— 编排层（铁律 A2：UI 不直接读写 IndexedDB，只经 services）。
 *
 * ★ 三条时间相关的硬约定（docs/04 §9）：
 *   1. **计时用 ticks 累加**（`tick(deltaSec)`），**不用 `Date` 差值** ——
 *      切后台 / 系统休眠会让 Date 差值产生巨大误差，而 ticks 只会少算不会多算。
 *   2. **总时长唯一来源 = `plan.totalSec`**（K2），本文件不重新求和、不写死 100/125。
 *   3. **`audioState` 本期恒 `'idle'`** —— 无音频源，类型保留为预留位。
 *
 * ★ 断点续考：每次作答按 `autosaveMs` 节流增量写盘，恢复时读回
 *   `answers` + `elapsedSec` + `remainingSec` + `cursorQuestionId`。
 */

export interface ExamSessionDeps {
  db?: Cet4Database;
  /** 注入时钟，便于单测确定性 */
  now?: () => number;
  /** 节流写盘间隔（ms）；0 表示每次作答都落盘 */
  autosaveMs?: number;
}

export interface StartExamInput {
  paperId: string;
  mode: AttemptMode;
  /** 由 buildSectionPlan(paper) 产出 —— 调用方不得自己算时长 */
  plan: SectionPlan;
  /** 不限时模式：remainingSec = null，倒计时不生效 */
  untimed?: boolean;
}

export interface SubmitResult {
  attempt: ExamAttempt;
  grade: GradeOutput;
  view: ExamResultView;
  recycle: RecycleReport;
  reason: 'manual' | 'auto';
}

export interface SessionSnapshot {
  attemptId: string;
  paperId: string;
  mode: AttemptMode;
  elapsedSec: number;
  remainingSec: number | null;
  cursorQuestionId?: string;
  answers: Readonly<Record<string, AnswerRecord>>;
  submitted: boolean;
}

/** 一次练习会话。用 `start()` / `resume()` 构造，不要直接 new。 */
export class ExamSession {
  readonly attemptId: string;
  readonly paperId: string;
  readonly mode: AttemptMode;
  readonly plan: SectionPlan;

  private readonly db: Cet4Database;
  private readonly now: () => number;
  private readonly autosaveMs: number;
  private readonly sheetId: string;
  private readonly startedAt: number;

  private answers: Record<string, AnswerRecord> = {};
  private elapsedSec = 0;
  private remainingSec: number | null;
  private cursorQuestionId: string | undefined;
  private lastSavedAt: number;
  private submitted = false;

  private constructor(init: {
    attemptId: string;
    sheetId: string;
    paperId: string;
    mode: AttemptMode;
    plan: SectionPlan;
    startedAt: number;
    lastSavedAt: number;
    elapsedSec: number;
    remainingSec: number | null;
    cursorQuestionId?: string;
    answers: Record<string, AnswerRecord>;
    submitted: boolean;
    deps: ExamSessionDeps;
  }) {
    this.attemptId = init.attemptId;
    this.sheetId = init.sheetId;
    this.paperId = init.paperId;
    this.mode = init.mode;
    this.plan = init.plan;
    this.startedAt = init.startedAt;
    this.lastSavedAt = init.lastSavedAt;
    this.elapsedSec = init.elapsedSec;
    this.remainingSec = init.remainingSec;
    this.cursorQuestionId = init.cursorQuestionId;
    this.answers = { ...init.answers };
    this.submitted = init.submitted;
    this.db = init.deps.db ?? defaultDb;
    this.now = init.deps.now ?? Date.now;
    this.autosaveMs = init.deps.autosaveMs ?? 1000;
  }

  /** 开一场新练习：写 attempt（ongoing）+ 空答题卡 */
  static async start(input: StartExamInput, deps: ExamSessionDeps = {}): Promise<ExamSession> {
    const db = deps.db ?? defaultDb;
    const now = (deps.now ?? Date.now)();
    const attemptId = uid('att');
    const sheetId = uid('as');

    const attempt: ExamAttempt = {
      id: attemptId,
      paperId: input.paperId,
      mode: input.mode,
      status: 'ongoing',
      startedAt: now,
      elapsedSec: 0,
      objectiveScore: 0,
      objectiveTotal: 0,
      sectionScores: [],
      scoreScaleNote: 'objective-only',
      wrongQuestionIds: [],
      newWordIds: [],
    };
    const sheet: AnswerSheet = {
      id: sheetId,
      attemptId,
      paperId: input.paperId,
      answers: {},
      elapsedSec: 0,
      startedAt: now,
      lastSavedAt: now,
      // 🎧 听力停用：无音频源，状态恒 idle（类型保留为预留位）
      audioState: 'idle',
      remainingSec: input.untimed === true ? null : input.plan.totalSec,
    };

    await db.transaction('rw', [db.attempts, db.answerSheets], async () => {
      await db.attempts.put(attempt);
      await db.answerSheets.put(sheet);
    });

    return new ExamSession({
      attemptId,
      sheetId,
      paperId: input.paperId,
      mode: input.mode,
      plan: input.plan,
      startedAt: now,
      lastSavedAt: now,
      elapsedSec: 0,
      remainingSec: sheet.remainingSec,
      answers: {},
      submitted: false,
      deps,
    });
  }

  /**
   * 断点续考：从 IndexedDB 恢复一场**未交卷**的练习。
   * plan 由 paper 重新推导（不落库）—— 保证恢复后与最新 sectionMeta 一致。
   */
  static async resume(
    attemptId: string,
    deps: ExamSessionDeps = {},
  ): Promise<ExamSession | undefined> {
    const db = deps.db ?? defaultDb;
    const attempt = await db.attempts.get(attemptId);
    if (!attempt || attempt.status !== 'ongoing') return undefined;

    const paper = await getPaper(attempt.paperId, db);
    if (!paper) return undefined;

    const sheet = await db.answerSheets.where('attemptId').equals(attemptId).first();
    if (!sheet) return undefined;

    return new ExamSession({
      attemptId,
      sheetId: sheet.id,
      paperId: attempt.paperId,
      mode: attempt.mode,
      plan: buildSectionPlan(paper),
      startedAt: attempt.startedAt,
      lastSavedAt: sheet.lastSavedAt,
      elapsedSec: sheet.elapsedSec,
      remainingSec: sheet.remainingSec,
      cursorQuestionId: sheet.cursorQuestionId,
      answers: { ...sheet.answers },
      submitted: false,
      deps,
    });
  }

  snapshot(): SessionSnapshot {
    return {
      attemptId: this.attemptId,
      paperId: this.paperId,
      mode: this.mode,
      elapsedSec: this.elapsedSec,
      remainingSec: this.remainingSec,
      cursorQuestionId: this.cursorQuestionId,
      answers: { ...this.answers },
      submitted: this.submitted,
    };
  }

  /** 作答（节流落盘）。`force` 用于切页 / 手动保存时立即写盘。 */
  async answer(
    questionId: string,
    value: string | null,
    options: { flag?: QuestionFlag; doubtful?: boolean; selfScore?: number; force?: boolean } = {},
  ): Promise<void> {
    const prev = this.answers[questionId];
    const next: AnswerRecord = {
      questionId,
      value,
      flag: options.flag ?? (value === null ? 'unanswered' : 'answered'),
      answeredAt: this.now(),
      revisions: (prev?.revisions ?? 0) + (prev ? 1 : 0),
    };
    if (options.doubtful !== undefined) next.doubtful = options.doubtful;
    if (options.selfScore !== undefined) next.selfScore = options.selfScore;

    this.answers[questionId] = next;
    this.cursorQuestionId = questionId;

    const elapsed = this.now() - this.lastSavedAt;
    if (options.force === true || this.autosaveMs === 0 || elapsed >= this.autosaveMs) {
      await this.flush();
    }
  }

  /** ★ 标记存疑 —— 该题错题将不进 FSRS（B6） */
  async markDoubtful(
    questionId: string,
    doubtful: boolean,
    reason?: DoubtReason,
  ): Promise<void> {
    const prev = this.answers[questionId] ?? {
      questionId,
      value: null,
      flag: 'unanswered' as QuestionFlag,
    };
    this.answers[questionId] = { ...prev, doubtful, doubtReason: reason };
    await this.flush();
  }

  /** 标记待定（回看书签，不影响判分） */
  async mark(questionId: string, flag: QuestionFlag): Promise<void> {
    const prev = this.answers[questionId] ?? { questionId, value: null, flag };
    this.answers[questionId] = { ...prev, flag };
    await this.flush();
  }

  async setCursor(questionId: string): Promise<void> {
    this.cursorQuestionId = questionId;
  }

  /**
   * 推进计时。**只接受增量秒数**（ticks），不接受时间戳。
   * @returns `expired` 为 true 时调用方应执行 `submit('auto')`
   */
  tick(deltaSec: number): { remainingSec: number | null; expired: boolean } {
    if (deltaSec < 0) throw new Error('tick: deltaSec 不得为负（ticks 只能累加）');
    this.elapsedSec += deltaSec;
    if (this.remainingSec !== null) {
      this.remainingSec = Math.max(0, this.remainingSec - deltaSec);
    }
    return { remainingSec: this.remainingSec, expired: this.remainingSec === 0 };
  }

  /** 强制落盘（切页 / 失焦 / 交卷前调用） */
  async flush(): Promise<void> {
    const now = this.now();
    const sheet: AnswerSheet = {
      id: this.sheetId,
      attemptId: this.attemptId,
      paperId: this.paperId,
      answers: { ...this.answers },
      cursorQuestionId: this.cursorQuestionId,
      elapsedSec: this.elapsedSec,
      startedAt: this.startedAt,
      lastSavedAt: now,
      remainingSec: this.remainingSec,
      audioState: 'idle',
    };
    await this.db.answerSheets.put(sheet);
    this.lastSavedAt = now;
  }

  /**
   * 交卷：批改 → 回流 → 落 attempt → 派生结果视图。
   * 幂等：重复调用直接返回上次结果所依赖的 attempt（不重复入错题本）。
   */
  async submit(reason: 'manual' | 'auto' = 'manual'): Promise<SubmitResult> {
    const now = this.now();
    const existing = await this.db.attempts.get(this.attemptId);
    if (this.submitted && existing?.status === 'submitted') {
      // 已交卷：重建视图但不重复回流（防双击 / 自动交卷与手动交卷竞争）
      return this.rebuild(existing, reason);
    }

    const allQuestions = await listQuestions(this.paperId, this.db);
    const questions = questionsInPlan(allQuestions, this.plan);
    const grade = gradeObjective({ questions, answers: this.answers });

    const byId = new Map<string, ExamQuestion>(questions.map((q) => [q.id, q]));
    const wordHints: Record<string, readonly string[]> = {};
    const newWordIds: string[] = [];
    for (const qid of grade.wrongQuestionIds) {
      const hints = byId.get(qid)?.keyWordHints ?? [];
      wordHints[qid] = hints;
      for (const w of hints) if (!newWordIds.includes(w)) newWordIds.push(w);
    }

    const recycle = await recycleAttempt(
      {
        attemptId: this.attemptId,
        paperId: this.paperId,
        wrongQuestionIds: grade.wrongQuestionIds,
        doubtfulQuestionIds: grade.doubtfulProblemIds,
        wordHintsByQuestion: wordHints,
        now,
      },
      this.db,
    );

    const attempt: ExamAttempt = {
      id: this.attemptId,
      paperId: this.paperId,
      mode: this.mode,
      status: 'submitted',
      startedAt: this.startedAt,
      submittedAt: now,
      elapsedSec: this.elapsedSec,
      // ★ 零换算口径：这里存的是**题数**而不是折算分（scoreScaleNote 恒为 'objective-only'）
      objectiveScore: grade.objectiveCorrect,
      objectiveTotal: grade.objectiveTotal,
      sectionScores: buildSectionScores(this.plan, questions, grade),
      scoreScaleNote: 'objective-only',
      wrongQuestionIds: grade.wrongQuestionIds,
      newWordIds,
    };

    await this.db.transaction('rw', [this.db.attempts, this.db.answerSheets], async () => {
      await this.db.attempts.put(attempt);
      await this.db.answerSheets.put({
        id: this.sheetId,
        attemptId: this.attemptId,
        paperId: this.paperId,
        answers: { ...this.answers },
        cursorQuestionId: this.cursorQuestionId,
        elapsedSec: this.elapsedSec,
        startedAt: this.startedAt,
        lastSavedAt: now,
        remainingSec: this.remainingSec,
        audioState: 'idle',
      });
    });

    this.submitted = true;

    return {
      attempt,
      grade,
      view: deriveResultView({ attempt, plan: this.plan, grade, questions }),
      recycle,
      reason,
    };
  }

  private async rebuild(attempt: ExamAttempt, reason: 'manual' | 'auto'): Promise<SubmitResult> {
    const questions = questionsInPlan(await listQuestions(this.paperId, this.db), this.plan);
    const grade = gradeObjective({ questions, answers: this.answers });
    return {
      attempt,
      grade,
      view: deriveResultView({ attempt, plan: this.plan, grade, questions }),
      recycle: {
        wrongAdded: 0,
        wrongUpdated: 0,
        vocabAdded: 0,
        doubtfulRejected: 0,
        acceptedQuestionIds: [],
      },
      reason,
    };
  }
}

/** 分项统计：按 plan.slots 遍历（K1），不按 kind 硬编码 */
function buildSectionScores(
  plan: SectionPlan,
  questions: readonly ExamQuestion[],
  grade: GradeOutput,
): ExamAttempt['sectionScores'] {
  return plan.slots.map((slot) => {
    const slotQuestions = questions.filter(
      (q) => q.no >= slot.questionFrom && q.no <= slot.questionTo,
    );
    const objective = slotQuestions.filter((q) => q.answer !== undefined);
    const correct = objective.filter((q) => grade.outcomes[q.id] === 'correct');
    return {
      kind: slot.meta.kind,
      correct: correct.length,
      total: objective.length,
      score: correct.reduce((s, q) => s + q.score, 0),
      rawTotal: slot.meta.rawScore,
    };
  });
}
