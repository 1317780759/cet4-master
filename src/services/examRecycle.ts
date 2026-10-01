import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import { addVocab, findVocab } from '@/data/repos/vocabRepo';
import { addWrong, findWrong, putWrong } from '@/data/repos/wrongRepo';

/**
 * 真题回流 —— 交卷后把「错题」与「生词」送进各自的闭环。
 *
 * ★★ B6 的第二道防线（docs/04 §4.3，本项目最硬的一条规则）
 *
 *   grader 已经保证 `wrongQuestionIds` 不含存疑题，为什么这里还要再拦一次？
 *   因为数据源**无官方底本可核对**，一条错误的标准答案若被当作错题送进复习调度，
 *   会**永久污染**用户的间隔重复计划 —— 比答案本身错更严重、且不可回滚。
 *   所以这里做**纵深防御**：即便上游传错、即便将来有人绕过 grader 直接调本函数，
 *   存疑题也进不了错题本。**不信任调用方**是本函数的设计前提。
 *
 * 另注：存疑题不是"丢弃"，而是走 `doubtfulProblemIds` → 待核对列表（本期不入 FSRS）。
 */

export interface RecycleInput {
  attemptId: string;
  paperId: string;
  /** 错题（应当已由 grader 排除存疑题；本函数仍会再过滤一次） */
  wrongQuestionIds: readonly string[];
  /** 存疑题 —— 显式传入以便在错题集合里做交叉剔除 */
  doubtfulQuestionIds?: readonly string[];
  /** questionId → 该词的提示词（ExamQuestion.keyWordHints），用于一键加入生词本 */
  wordHintsByQuestion?: Readonly<Record<string, readonly string[]>>;
  /** 交卷来源，决定 WrongBookRow.source（模考练习统一为 'practice'） */
  source?: 'practice' | 'mock';
  now?: number;
}

export interface RecycleReport {
  /** 新增错题条目数 */
  wrongAdded: number;
  /** 命中既有条目、累加 wrongCount 的数目 */
  wrongUpdated: number;
  /** 新增生词数（已去重、已排除生词本里已有的） */
  vocabAdded: number;
  /** ★ 被本函数拦截的存疑题数量 —— 正常应为 0（>0 说明 grader 契约被破坏，值得报警） */
  doubtfulRejected: number;
  /** 被剔除后实际入错题本的题号 */
  acceptedQuestionIds: string[];
}

/**
 * 执行回流。纯副作用（写 IndexedDB），不返回业务对象。
 */
export async function recycleAttempt(
  input: RecycleInput,
  instance: Cet4Database = defaultDb,
): Promise<RecycleReport> {
  const now = input.now ?? Date.now();
  const source = input.source ?? 'practice';

  // ★ 纵深防御：即便上游漏过滤，存疑题也绝不进错题本
  const doubtful = new Set(input.doubtfulQuestionIds ?? []);
  const accepted = input.wrongQuestionIds.filter((id) => !doubtful.has(id));
  const doubtfulRejected = input.wrongQuestionIds.length - accepted.length;

  let wrongAdded = 0;
  let wrongUpdated = 0;

  for (const questionId of accepted) {
    const existing = await findWrong({ questionId, paperId: input.paperId }, instance);
    if (existing?.id !== undefined) {
      // 二次错同一题：只累加频次并重置到期时间（不重复插入）
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
      wrongUpdated += 1;
    } else {
      await addWrong(
        {
          questionId,
          paperId: input.paperId,
          source,
          wrongCount: 1,
          firstWrongAt: now,
          lastWrongAt: now,
          enqueued: true,
          nextDue: now,
          resolved: false,
        },
        instance,
      );
      wrongAdded += 1;
    }
  }

  // —— 生词本：只从**已确认错题**（非存疑）里取 keyWordHints ——
  let vocabAdded = 0;
  const hints = input.wordHintsByQuestion;
  if (hints) {
    for (const questionId of accepted) {
      for (const wordId of hints[questionId] ?? []) {
        // ⚠️ 必须**写入前**判断是否存在：不能靠"返回的 addedAt 是否等于 now"反推 ——
        //    同一次导入里两次回流若共享同一时间戳，该判断会把已有条目误判为新增（重复计数）。
        if ((await findVocab(wordId, instance)) !== undefined) continue;
        await addVocab({ wordId, origin: { paperId: input.paperId, questionId }, now }, instance);
        vocabAdded += 1;
      }
    }
  }

  return {
    wrongAdded,
    wrongUpdated,
    vocabAdded,
    doubtfulRejected,
    acceptedQuestionIds: [...accepted],
  };
}
