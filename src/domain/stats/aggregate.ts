/**
 * 学习统计聚合 —— 铁律 A1：纯函数，零 React / 零 IO。
 *
 * 输入采用**结构类型**（StudyLogLike / DailyStatLike），刻意不 import `@/data/db`，
 * 以免领域层反向依赖存储层。
 */

import { diffDays, toDateKey } from '@/lib/date';

export type StatAction = 'learn' | 'review' | 'quiz' | 'wrong' | 'master';
export type StatRating = 1 | 2 | 3 | 4;

/** 与 StudyLogRow 结构兼容的精简视图 */
export interface StudyLogLike {
  ts: number;
  date: string;
  wordId: string;
  action: StatAction;
  rating?: StatRating;
  peeked?: boolean;
  elapsedMs?: number;
}

/** 与 DailyStatRow 结构兼容 */
export interface DailyStatLike {
  date: string;
  newLearned: number;
  reviewed: number;
  correct: number;
  wrong: number;
  minutes: number;
  goalDone: boolean;
}

export const EMPTY_DAILY_STAT = (date: string): DailyStatLike => ({
  date,
  newLearned: 0,
  reviewed: 0,
  correct: 0,
  wrong: 0,
  minutes: 0,
  goalDone: false,
});

export interface TodaySummary extends DailyStatLike {
  /** 正确率 0..1（无作答时为 0） */
  accuracy: number;
  /** 相对每日目标的完成度 0..1 */
  goalRatio: number;
}

/**
 * 从事件日志实时聚合「今日」摘要（统计页在写日志后即时刷新用）。
 * 纯函数，不读数据库。
 */
export function summarizeDay(
  logs: readonly StudyLogLike[],
  date: string,
  dailyGoal: number,
): TodaySummary {
  let newLearned = 0;
  let reviewed = 0;
  let correct = 0;
  let wrong = 0;
  let ms = 0;
  for (const log of logs) {
    if (log.date !== date) continue;
    if (log.action === 'learn') newLearned += 1;
    if (log.action === 'review' || log.action === 'learn') reviewed += 1;
    if (log.rating !== undefined) {
      if (log.rating >= 3) correct += 1;
      else wrong += 1;
    }
    ms += log.elapsedMs ?? 0;
  }
  const answered = correct + wrong;
  const goal = Math.max(1, dailyGoal);
  return {
    date,
    newLearned,
    reviewed,
    correct,
    wrong,
    minutes: Math.round(ms / 60_000),
    goalDone: newLearned >= goal,
    accuracy: answered > 0 ? correct / answered : 0,
    goalRatio: Math.min(1, newLearned / goal),
  };
}

/**
 * 增量合并一条日志到日统计（studySession.finish / rate 时调用）。
 * 纯函数：给定旧值与日志，算出新值，落库交给 repos。
 */
export function applyLogToDailyStat(
  previous: DailyStatLike | null | undefined,
  log: StudyLogLike,
  dailyGoal: number,
): DailyStatLike {
  const base = previous ?? EMPTY_DAILY_STAT(log.date);
  const next: DailyStatLike = { ...base };
  if (log.action === 'learn') {
    next.newLearned += 1;
    next.reviewed += 1;
  } else if (log.action === 'review') {
    next.reviewed += 1;
  }
  if (log.rating !== undefined) {
    if (log.rating >= 3) next.correct += 1;
    else next.wrong += 1;
  }
  next.minutes = base.minutes + Math.round((log.elapsedMs ?? 0) / 60_000);
  next.goalDone = next.newLearned >= Math.max(1, dailyGoal);
  return next;
}

export interface TrendPoint {
  date: string;
  reviewed: number;
  newLearned: number;
}

/**
 * 生成最近 n 天的趋势序列（缺失日期补 0），供折线图使用。
 */
export function buildTrend(
  stats: readonly DailyStatLike[],
  days: number,
  today: string = toDateKey(),
): TrendPoint[] {
  const byDate = new Map(stats.map((s) => [s.date, s]));
  const points: TrendPoint[] = [];
  const span = Math.max(1, Math.floor(days));
  for (let i = span - 1; i >= 0; i -= 1) {
    const date = shiftDate(today, -i);
    const row = byDate.get(date);
    points.push({
      date,
      reviewed: row?.reviewed ?? 0,
      newLearned: row?.newLearned ?? 0,
    });
  }
  return points;
}

/** 掌握度分布（环形图用）：returning 各档词数 */
export interface MasteryDistribution {
  new: number;
  learning: number;
  young: number;
  mature: number;
}

export function masteryTotal(dist: MasteryDistribution): number {
  return dist.new + dist.learning + dist.young + dist.mature;
}

/** 连续有学习记录的天数是否包含今天 */
export function hasActivityOn(stats: readonly DailyStatLike[], date: string): boolean {
  return stats.some((s) => s.date === date && (s.reviewed > 0 || s.newLearned > 0));
}

/** 最近一次学习日期（无记录返回 null） */
export function lastActiveDate(stats: readonly DailyStatLike[]): string | null {
  let latest: string | null = null;
  for (const s of stats) {
    if (s.reviewed === 0 && s.newLearned === 0) continue;
    if (latest === null || diffDays(latest, s.date) > 0) latest = s.date;
  }
  return latest;
}

/** 本地日期偏移（避免依赖 lib/date 的 addDays 语义，保持本函数自洽） */
function shiftDate(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  return toDateKey(dt.getTime());
}
