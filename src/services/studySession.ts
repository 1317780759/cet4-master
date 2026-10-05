/**
 * 背词会话状态机 —— 服务编排层（铁律 A2：UI 只经 services）。
 *
 * ★ 这是「选词 / 评级」的**唯一入口**：
 *   - 选词：`startSession()` 内部走 `domain/word/selector`（纯函数，词频优先）
 *   - 评级：`rateWord()` 内部走 `domain/fsrs/scheduler`（纯函数，Again 当日重现）
 *
 * 设计取舍：新词的 `ReviewCard` **在首次评级时才落库**（不随会话开始写入），
 * 这样「中途放弃的会话」不会留下脏进度；对应方案 5.2 的 createEmptyCards 语义，
 * 差异仅在于写盘时机（更安全，且不影响 FSRS 行为）。
 */

import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { DailyStatRow, StudyAction } from '@/data/db/rows';
import { listDue, putCard } from '@/data/repos/cardRepo';
import { appendLog, getDailyStat, listDailyStats, upsertDailyStat } from '@/data/repos/logRepo';
import { listWrong } from '@/data/repos/wrongRepo';
import { getWords } from '@/data/repos/wordRepo';
import { isWrongAnswer, resolveRating, type RatingOptions } from '@/domain/fsrs/rating-map';
import { next, preview, requeueSameDay, schedule, type ScheduleResult } from '@/domain/fsrs/scheduler';
import { createCard, type FsrsRating, type RatingInput, type ReviewCard } from '@/domain/fsrs/types';
import { isStudyOrder, type StudyOrder, type TierFilter } from '@/domain/settings/types';
import { pickNewWords, shuffle } from '@/domain/word/selector';
import { toIndexRow, type Word, type WordIndexRow } from '@/domain/word/types';
import { activeDates, currentStreak } from '@/domain/stats/streak';
import { toDateKey } from '@/lib/date';
import { enqueueWrong } from './wrongBookService';

export type SessionMode = 'learn' | 'review';

/** 队列中的一项：词 + 其当前卡片状态 */
export interface StudyItem {
  word: Word;
  card: ReviewCard;
  /** true = 本次会话首次引入的新词 */
  isNew: boolean;
  /** 该卡最早可作答时刻（epoch ms）；缺省=立即可答。Again 重现卡在其 due 前不得展示（R-A1） */
  notBefore?: number;
}

export interface StudyQueue {
  mode: SessionMode;
  items: StudyItem[];
  newCount: number;
  reviewCount: number;
}

export interface StartSessionOptions {
  tier?: TierFilter;
  /** 每日新词量（默认 20） */
  dailyGoal?: number;
  /** 每日复习上限（默认 200，防雪崩） */
  reviewLimit?: number;
  /** 出词顺序（v2）；不给则按 v1 语义处理，见 orderOf() */
  studyOrder?: StudyOrder;
  /**
   * @deprecated v1 布尔开关，仅作兼容输入。
   * `studyOrder` 未给时：`freqOrdering === false` → 随机，否则 → 词频。
   */
  freqOrdering?: boolean;
  /** 随机源（随机档使用），默认 Math.random —— 注入后可单测 */
  random?: () => number;
  now?: number;
}

/** 归一化出词顺序：优先 studyOrder，退回 v1 的 freqOrdering，最终兜底词频 */
function orderOf(options: StartSessionOptions): StudyOrder {
  if (isStudyOrder(options.studyOrder)) return options.studyOrder;
  if (options.freqOrdering === false) return 'random';
  return 'freq';
}

/**
 * 记忆弱度分：越大越该先复习。
 * 遗忘次数权重最高（忘过 = 真没掌握），其次看稳定性（越短越不稳）。
 */
function weaknessScore(card: ReviewCard): number {
  return card.lapses * 100 - card.stability;
}

/**
 * 按出词顺序重排**复习部分**。
 *
 * - `freq`  ：词频升序
 * - `random`：洗牌
 * - `weak`  ：弱卡在前（lapses 多 / stability 低）
 * - `wrong` ：错题本里的词在前，其余保持原相对次序（sort 稳定）
 *
 * 纯函数（wrongIds 由调用方注入），可单测。
 */
export function orderReviewItems(
  items: readonly StudyItem[],
  order: StudyOrder,
  wrongIds: ReadonlySet<string> = new Set(),
  random: () => number = Math.random,
): StudyItem[] {
  if (order === 'freq') {
    return [...items].sort((a, b) =>
      a.word.freqRank === b.word.freqRank
        ? a.word.id < b.word.id
          ? -1
          : 1
        : a.word.freqRank - b.word.freqRank,
    );
  }
  if (order === 'weak') {
    return [...items].sort((a, b) => weaknessScore(b.card) - weaknessScore(a.card));
  }
  if (order === 'wrong') {
    return [...items].sort((a, b) => Number(wrongIds.has(b.word.id)) - Number(wrongIds.has(a.word.id)));
  }
  return shuffle(items, random);
}

/** 按档位取出候选行（列式索引，供纯函数 selector 使用） */
async function selectionRows(
  instance: Cet4Database,
  tier: TierFilter,
): Promise<WordIndexRow[]> {
  if (tier === 'all') {
    const words = await instance.words.orderBy('freqRank').toArray();
    return words.map(toIndexRow);
  }
  const words = await instance.words.where('tier').equals(tier).sortBy('freqRank');
  return words.map(toIndexRow);
}

/** 已建卡的词 id 集合（新词选词时排除，避免重复引入） */
async function existingWordIds(instance: Cet4Database): Promise<Set<string>> {
  const keys = await instance.cards.toCollection().primaryKeys();
  return new Set(keys.map((k) => String(k)));
}

/**
 * 构建一次会话队列。
 * - `learn`：到期复习（≤ reviewLimit）+ 新词（= dailyGoal，词频升序）
 * - `review`：仅到期复习
 */
export async function startSession(
  mode: SessionMode,
  options: StartSessionOptions = {},
  instance: Cet4Database = defaultDb,
): Promise<StudyQueue> {
  const now = options.now ?? Date.now();
  const dailyGoal = Math.max(0, Math.floor(options.dailyGoal ?? 20));
  const reviewLimit = Math.max(0, Math.floor(options.reviewLimit ?? 200));
  const order = orderOf(options);
  const random = options.random ?? Math.random;

  const dueCards = reviewLimit > 0 ? await listDue(now, reviewLimit, instance) : [];

  let newRows: WordIndexRow[] = [];
  if (mode === 'learn' && dailyGoal > 0) {
    const tier = options.tier ?? 'core2104';
    const exclude = await existingWordIds(instance);
    const rows = await selectionRows(instance, tier);
    newRows = pickNewWords(rows, {
      limit: dailyGoal,
      tier,
      exclude,
      order,
      random,
    });
  }

  const ids = [...dueCards.map((c) => c.wordId), ...newRows.map((r) => r.id)];
  const words = await getWords(ids, instance);
  const byId = new Map(words.map((w) => [w.id, w]));

  // R-A3：防御性去重，同一 wordId 只保留首次出现（dueCards 与 newRows 理论上互斥）
  const seen = new Set<string>();
  const reviewItems: StudyItem[] = [];
  for (const card of dueCards) {
    const word = byId.get(card.wordId);
    if (word && !seen.has(word.id)) {
      seen.add(word.id);
      reviewItems.push({ word, card, isNew: false });
    }
  }
  const newItems: StudyItem[] = [];
  for (const row of newRows) {
    const word = byId.get(row.id);
    if (!word || seen.has(word.id)) continue;
    seen.add(word.id);
    newItems.push({ word, card: createCard(word.id, word.freqRank, now), isNew: true });
  }

  // 出词顺序：复习部分按档重排；新词部分沿用 selector 的结果（随机档已洗过牌）
  const wrongIds =
    order === 'wrong'
      ? new Set(
          (await listWrong({}, instance))
            .map((row) => row.wordId)
            .filter((id): id is string => typeof id === 'string'),
        )
      : new Set<string>();

  const items: StudyItem[] = [
    ...orderReviewItems(reviewItems, order, wrongIds, random),
    ...newItems,
  ];

  return {
    mode,
    items,
    newCount: items.filter((i) => i.isNew).length,
    reviewCount: items.filter((i) => !i.isNew).length,
  };
}

export interface RateOptions extends RatingOptions {
  /** 日统计聚合用（默认 20） */
  dailyGoal?: number;
  now?: number;
}

export interface RateResult extends ScheduleResult {
  rating: FsrsRating;
  /** 记录到日志的动作类型 */
  action: StudyAction;
  isWrong: boolean;
}

/**
 * 评级一个词 —— 背词闭环的**唯一写入点**。
 * 一次调用完成：评分映射 → FSRS 推进 → 卡片落库 → 事件日志 → 日统计 →（答错时）错题入队。
 */
export async function rateWord(
  item: StudyItem,
  input: RatingInput,
  options: RateOptions = {},
  instance: Cet4Database = defaultDb,
): Promise<RateResult> {
  const now = options.now ?? Date.now();
  const rating = resolveRating(input, {
    peekPenalty: options.peekPenalty ?? true,
    hesitationMs: options.hesitationMs,
  });

  const result = schedule(item.card, rating, now);
  await putCard(result.card, instance);

  const action: StudyAction = item.isNew ? 'learn' : 'review';
  const log = {
    ts: now,
    date: toDateKey(now),
    wordId: item.word.id,
    action,
    rating,
    peeked: input.peeked,
    elapsedMs: input.elapsedMs,
  };
  await appendLog(log, instance);
  await upsertDailyStat(log, Math.max(1, options.dailyGoal ?? 20), instance);

  const isWrong = isWrongAnswer(rating);
  if (isWrong) {
    await enqueueWrong({ wordId: item.word.id, source: 'card', now }, instance);
  }

  return { ...result, rating, action, isWrong };
}

/** 手动「已掌握」/ 移出队列（R07） */
export async function setCardSuspended(
  card: ReviewCard,
  suspended: boolean,
  instance: Cet4Database = defaultDb,
): Promise<ReviewCard> {
  const next: ReviewCard = { ...card, suspended };
  await putCard(next, instance);
  return next;
}

/** 强制当日重现（供「再练一次」按钮复用同一套策略：保留原生 Again 落点，再以 Hard 的 due 钳制） */
export function requeue(card: ReviewCard, now: number = Date.now()): ReviewCard {
  return requeueSameDay(next(card, 1, now), next(card, 2, now).due);
}

/** 四个评级的落点预览（RatingBar 提示用） */
export function previewIntervals(card: ReviewCard, now: number = Date.now()): Record<FsrsRating, ScheduleResult> {
  return preview(card, now);
}

export interface SessionSummary {
  date: string;
  reviewed: number;
  newLearned: number;
  correct: number;
  wrong: number;
  minutes: number;
  /** 当前连续打卡天数（含今天） */
  streak: number;
}

/**
 * 结束会话 —— 汇总当日日统计并计算连续打卡（方案 5.2 的 finish 语义）。
 * 连续打卡天数的「+1」由 `currentStreak` 依据当天是否有活动自然反映。
 */
export async function finishSession(
  now: number = Date.now(),
  instance: Cet4Database = defaultDb,
): Promise<SessionSummary> {
  const date = toDateKey(now);
  const [today, stats] = await Promise.all([
    getDailyStat(date, instance),
    listDailyStats(400, instance),
  ]);
  return {
    date,
    reviewed: today?.reviewed ?? 0,
    newLearned: today?.newLearned ?? 0,
    correct: today?.correct ?? 0,
    wrong: today?.wrong ?? 0,
    minutes: today?.minutes ?? 0,
    streak: currentStreak(activeDates(stats), date),
  };
}

export type { DailyStatRow };
