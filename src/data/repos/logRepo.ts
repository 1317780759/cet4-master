import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import { applyLogToDailyStat, type DailyStatLike, type StudyLogLike } from '@/domain/stats/aggregate';
import type { DailyStatRow, StudyLogRow } from '@/data/db/rows';

/**
 * 学习日志 + 日统计仓库 —— 用户进度区。
 * 事件级日志（studyLogs）是热力图 / 趋势图的数据源；
 * 日统计（dailyStats）是预聚合，避免每次打开统计页扫全表。
 */

/** 追加一条事件日志，返回自增主键 */
export async function appendLog(
  log: Omit<StudyLogRow, 'id'>,
  instance: Cet4Database = defaultDb,
): Promise<number> {
  return instance.studyLogs.add(log);
}

export async function getDailyStat(
  date: string,
  instance: Cet4Database = defaultDb,
): Promise<DailyStatRow | undefined> {
  return instance.dailyStats.get(date);
}

export async function putDailyStat(
  row: DailyStatRow,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  await instance.dailyStats.put(row);
}

/**
 * 把一条日志增量累加进当天的日统计（纯计算在 domain/stats，这里只做 IO）。
 * ★ 与 `applyLogToDailyStat` 共用同一套聚合规则，避免两处口径漂移。
 */
export async function upsertDailyStat(
  log: StudyLogLike,
  dailyGoal: number,
  instance: Cet4Database = defaultDb,
): Promise<DailyStatRow> {
  const previous = await getDailyStat(log.date, instance);
  const next = applyLogToDailyStat(previous as DailyStatLike | undefined, log, dailyGoal);
  await putDailyStat(next, instance);
  return next;
}

/** 某天的全部日志 */
export async function listLogsByDate(
  date: string,
  instance: Cet4Database = defaultDb,
): Promise<StudyLogRow[]> {
  return instance.studyLogs.where('date').equals(date).toArray();
}

/** 从某时间戳起的日志（趋势图用） */
export async function listLogsSince(
  ts: number,
  instance: Cet4Database = defaultDb,
): Promise<StudyLogRow[]> {
  return instance.studyLogs.where('ts').aboveOrEqual(ts).toArray();
}

/** 最近 limit 条日志（ts 降序） */
export async function listLogs(
  limit = 200,
  instance: Cet4Database = defaultDb,
): Promise<StudyLogRow[]> {
  const rows = await instance.studyLogs.orderBy('ts').reverse().limit(limit).toArray();
  return rows;
}

export async function countLogs(instance: Cet4Database = defaultDb): Promise<number> {
  return instance.studyLogs.count();
}

/** 最近 limit 天的日统计（date 降序，最新在前） */
export async function listDailyStats(
  limit = 400,
  instance: Cet4Database = defaultDb,
): Promise<DailyStatRow[]> {
  const rows = await instance.dailyStats.orderBy('date').reverse().limit(limit).toArray();
  return rows;
}

/** 清理超出保留窗口的旧日志（默认保留 180 天，方案 3.5） */
export async function pruneLogs(
  keepDays = 180,
  now: number = Date.now(),
  instance: Cet4Database = defaultDb,
): Promise<number> {
  const cutoff = now - keepDays * 86_400_000;
  return instance.studyLogs.where('ts').below(cutoff).delete();
}
