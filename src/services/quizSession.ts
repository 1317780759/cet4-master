import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import { addWrong, findWrong, putWrong } from '@/data/repos/wrongRepo';
import type { OptionKey, QuizQuestion } from '@/domain/quiz/generator';

/**
 * 测验会话编排 —— 判分 + 回流 + 落会话记录。
 *
 * ★ 与真题回流（`examRecycle`）的**关键差异**：
 *   真题有"存疑"概念（无官方底本，答案未必可信 → 存疑不入 FSRS）；
 *   而**测验的答案是词库自带的释义，可信** —— 所以答错一律入错题本，没有存疑分流。
 *   把两条路径分开写，是为了避免将来有人把 B6 的"存疑"逻辑误套到测验上，
 *   那会让用户**永远练不到自己真正错的词**。
 */

export type QuizOutcome = 'correct' | 'wrong' | 'blank';

export interface QuizAnswer {
  questionId: string;
  /** null = 未作答 */
  selectedKey: OptionKey | null;
}

export interface QuizGradeResult {
  correct: number;
  total: number;
  outcomes: Record<string, QuizOutcome>;
  /** 答错或未答的**被考词** → 入错题本（去重后） */
  wrongWordIds: string[];
}

/** 判分（纯函数，可单测） */
export function gradeQuiz(
  questions: readonly QuizQuestion[],
  answers: Readonly<Record<string, QuizAnswer>>,
): QuizGradeResult {
  const outcomes: Record<string, QuizOutcome> = {};
  const wrongWordIds: string[] = [];
  let correct = 0;

  for (const q of questions) {
    const picked = answers[q.id]?.selectedKey ?? null;
    let outcome: QuizOutcome;
    if (picked === null) {
      outcome = 'blank';
    } else if (picked === q.answerKey) {
      outcome = 'correct';
      correct += 1;
    } else {
      outcome = 'wrong';
    }
    outcomes[q.id] = outcome;

    // 答错与未答都算"没掌握"，都回流（未答同样暴露记忆缺口）
    if (outcome !== 'correct' && !wrongWordIds.includes(q.wordId)) {
      wrongWordIds.push(q.wordId);
    }
  }

  return { correct, total: questions.length, outcomes, wrongWordIds };
}

/** 开一场测验，返回自增会话 id */
export async function startQuizSession(
  type: 'choice' | 'cloze' | 'rapid' = 'choice',
  instance: Cet4Database = defaultDb,
  now: number = Date.now(),
): Promise<number> {
  return instance.quizSessions.add({ startedAt: now, type });
}

/** 结束测验：落正确数 / 总数 */
export async function finishQuizSession(
  sessionId: number,
  result: { correct: number; total: number },
  instance: Cet4Database = defaultDb,
  now: number = Date.now(),
): Promise<void> {
  const session = await instance.quizSessions.get(sessionId);
  if (!session) return;
  await instance.quizSessions.put({
    ...session,
    finishedAt: now,
    correct: result.correct,
    total: result.total,
  });
}

export interface QuizRecycleReport {
  added: number;
  updated: number;
}

/** 测验错题入错题本（source='quiz'），重复错只累加频次 */
export async function recycleQuizWrong(
  wordIds: readonly string[],
  instance: Cet4Database = defaultDb,
  now: number = Date.now(),
): Promise<QuizRecycleReport> {
  let added = 0;
  let updated = 0;

  for (const wordId of wordIds) {
    const existing = await findWrong({ wordId, source: 'quiz' }, instance);
    if (existing?.id !== undefined) {
      await putWrong(
        {
          ...existing,
          wrongCount: existing.wrongCount + 1,
          lastWrongAt: now,
          nextDue: now,
          enqueued: true,
          resolved: false,
        },
        instance,
      );
      updated += 1;
    } else {
      await addWrong(
        {
          wordId,
          source: 'quiz',
          wrongCount: 1,
          firstWrongAt: now,
          lastWrongAt: now,
          enqueued: true,
          nextDue: now,
          resolved: false,
        },
        instance,
      );
      added += 1;
    }
  }

  return { added, updated };
}
