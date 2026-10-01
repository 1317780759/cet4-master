import type { ReactNode } from 'react';
import type { HeatLevel, HeatmapGrid } from '@/domain/stats/heatmap';
import { cn } from '@/lib/cn';

/** 五档强度配色（静态类名，避免 Tailwind 无法收集动态类） */
const LEVEL_FILL: Record<HeatLevel, string> = {
  0: 'fill-slate-100 dark:fill-slate-800',
  1: 'fill-emerald-200 dark:fill-emerald-900',
  2: 'fill-emerald-400 dark:fill-emerald-700',
  3: 'fill-emerald-600 dark:fill-emerald-500',
  4: 'fill-emerald-800 dark:fill-emerald-300',
};

const CELL = 10;
const GAP = 3;
const LABEL_W = 18;
const LABEL_H = 14;

export interface HeatmapCalendarProps {
  grid: HeatmapGrid;
  className?: string;
}

/**
 * 自研年度热力图（打卡日历）—— 纯 SVG，零依赖。
 * 每列一周（周一→周日），右端对齐本周。
 */
export function HeatmapCalendar({ grid, className }: HeatmapCalendarProps): ReactNode {
  const weeks = grid.weeks.length;
  if (weeks === 0) {
    return <p className={cn('text-sm text-slate-400 dark:text-slate-500', className)}>暂无数据</p>;
  }

  const width = LABEL_W + weeks * (CELL + GAP);
  const height = LABEL_H + 7 * (CELL + GAP);
  const weekdayLabels = ['一', '', '三', '', '五', '', '日'];

  return (
    <div className={cn('overflow-x-auto', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[420px]" role="img" aria-label="学习打卡热力图">
        {grid.monthLabels.map((label) => (
          <text
            key={`m-${label.weekIndex}`}
            x={LABEL_W + label.weekIndex * (CELL + GAP)}
            y={10}
            className="fill-slate-400 text-[9px] dark:fill-slate-500"
          >
            {label.month}月
          </text>
        ))}

        {weekdayLabels.map((label, index) =>
          label ? (
            <text
              key={`d-${index}`}
              x={0}
              y={LABEL_H + index * (CELL + GAP) + CELL - 1}
              className="fill-slate-400 text-[9px] dark:fill-slate-500"
            >
              {label}
            </text>
          ) : null,
        )}

        {grid.weeks.map((column, weekIndex) =>
          column.map((cell, dayIndex) => (
            <rect
              key={cell.date}
              x={LABEL_W + weekIndex * (CELL + GAP)}
              y={LABEL_H + dayIndex * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              className={LEVEL_FILL[cell.level]}
            >
              <title>
                {cell.date}：{cell.count} 次
              </title>
            </rect>
          )),
        )}
      </svg>
    </div>
  );
}

/** 热力图图例（少 → 多） */
export function HeatmapLegend({ className }: { className?: string }): ReactNode {
  return (
    <div className={cn('flex items-center justify-end gap-1 text-[10px] text-slate-400 dark:text-slate-500', className)}>
      <span>少</span>
      {([0, 1, 2, 3, 4] as HeatLevel[]).map((level) => (
        <span key={level} className={cn('inline-block h-2.5 w-2.5 rounded-sm', LEVEL_FILL[level])} />
      ))}
      <span>多</span>
    </div>
  );
}
