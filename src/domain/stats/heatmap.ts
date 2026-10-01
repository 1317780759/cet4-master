/**
 * 年度热力图数据构造 —— 铁律 A1：纯函数，零 IO。
 * 输出「周列 × 7 天」的网格，交给自研 SVG 组件渲染（不引图表库）。
 */

import { toDateKey } from '@/lib/date';

export interface HeatmapCell {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 当日学习次数（复习 + 新学） */
  count: number;
  /** 0..4 强度档 */
  level: HeatLevel;
  /** 是否属于本周之后（未来占位格） */
  future: boolean;
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatmapGrid {
  /** 每周一列，每列 7 格（周一 → 周日） */
  weeks: HeatmapCell[][];
  /** 月标签：[周列索引, 月份] */
  monthLabels: Array<{ weekIndex: number; month: number }>;
  /** 统计期内总次数 */
  total: number;
  /** 单日峰值 */
  max: number;
}

/** 次数 → 强度档（GitHub 风格五档） */
export function levelOf(count: number, max: number): HeatLevel {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** 某天的星期几（周一=0..周日=6） */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** 平移日期 */
function shift(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  return toDateKey(dt.getTime());
}

export interface HeatmapOptions {
  /** 展示多少周（默认 26 周 ≈ 半年） */
  weeks?: number;
  /** 今天（dateKey），默认本地今天 */
  today?: string;
}

/**
 * 构造热力图网格。
 * @param activity dateKey → 当日次数
 */
export function buildHeatmap(
  activity: ReadonlyMap<string, number> | Record<string, number>,
  options: HeatmapOptions = {},
): HeatmapGrid {
  const get = (key: string): number =>
    activity instanceof Map ? (activity.get(key) ?? 0) : ((activity as Record<string, number>)[key] ?? 0);

  const today = options.today ?? toDateKey();
  const weeks = Math.max(1, Math.floor(options.weeks ?? 26));
  const todayDate = new Date(today.replace(/-/g, '/'));

  // 网格右端对齐到本周日
  const endKey = shift(today, 6 - mondayIndex(todayDate));
  const startKey = shift(endKey, -(weeks * 7 - 1));

  let total = 0;
  let max = 0;
  const columns: HeatmapCell[][] = [];
  const monthLabels: Array<{ weekIndex: number; month: number }> = [];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w += 1) {
    const column: HeatmapCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = shift(startKey, w * 7 + d);
      const count = get(date);
      total += count;
      if (count > max) max = count;
      column.push({ date, count, level: 0, future: date > today });
      const month = Number(date.slice(5, 7));
      if (d === 0 && month !== lastMonth) {
        monthLabels.push({ weekIndex: w, month });
        lastMonth = month;
      }
    }
    columns.push(column);
  }

  for (const column of columns) {
    for (const cell of column) {
      cell.level = cell.future ? 0 : levelOf(cell.count, max);
    }
  }

  return { weeks: columns, monthLabels, total, max };
}

/** 把日统计行数组转成 热力图 activity 映射 */
export function activityFromStats(
  rows: readonly { date: string; reviewed: number; newLearned: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.date, (map.get(row.date) ?? 0) + row.reviewed + row.newLearned);
  }
  return map;
}
