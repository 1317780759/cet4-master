/**
 * 连续打卡（连续学习天数）—— 铁律 A1：纯函数，零 IO。
 */

import { addDays, diffDays, toDateKey } from '@/lib/date';

/**
 * 当前连续天数。
 * 今天有记录 → 从今天往前数；今天没记录但昨天有 → 从昨天往前数（当天还没学不算断）。
 * 否则为 0。
 */
export function currentStreak(dates: readonly string[], today: string = toDateKey()): number {
  const set = new Set(dates);
  let anchor: string;
  if (set.has(today)) anchor = today;
  else if (set.has(addDays(today, -1))) anchor = addDays(today, -1);
  else return 0;

  let streak = 0;
  let cursor = anchor;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 历史最长连续天数 */
export function longestStreak(dates: readonly string[]): number {
  const unique = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of unique) {
    if (prev !== null && diffDays(prev, date) === 1) run += 1;
    else run = 1;
    if (run > best) best = run;
    prev = date;
  }
  return best;
}

/** 从「有活动的日统计」里提取日期列表（reviewed>0 或 newLearned>0 才算） */
export function activeDates(rows: readonly { date: string; reviewed: number; newLearned: number }[]): string[] {
  return rows.filter((r) => r.reviewed > 0 || r.newLearned > 0).map((r) => r.date);
}
