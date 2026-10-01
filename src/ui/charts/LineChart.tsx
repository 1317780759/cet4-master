import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface LineSeries {
  label: string;
  /** 折线颜色（CSS color） */
  color: string;
  values: number[];
}

export interface LineChartProps {
  series: LineSeries[];
  /** X 轴标签（与 values 等长），为空则不显示 */
  labels?: string[];
  height?: number;
  /** Y 轴上限；不传则按数据自适应 */
  yMax?: number;
  className?: string;
}

const WIDTH = 640;
const PAD_X = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 20;

/**
 * 自研折线图 —— 纯 SVG，零依赖（方案 1.1：不引 ECharts / Recharts）。
 */
export function LineChart({ series, labels, height = 180, yMax, className }: LineChartProps): ReactNode {
  const count = Math.max(0, ...series.map((s) => s.values.length));
  if (count === 0) {
    return <p className={cn('text-sm text-slate-400 dark:text-slate-500', className)}>暂无数据</p>;
  }

  const chartH = height - PAD_TOP - PAD_BOTTOM;
  const dataMax = Math.max(1, ...series.flatMap((s) => s.values));
  const max = Math.max(1, yMax ?? dataMax);
  const stepX = count > 1 ? (WIDTH - PAD_X * 2) / (count - 1) : 0;
  const pointAt = (index: number, value: number): [number, number] => [
    PAD_X + index * stepX,
    PAD_TOP + chartH * (1 - value / max),
  ];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className={cn('h-auto w-full', className)}
      role="img"
      aria-label={series.map((s) => s.label).join('、')}
    >
      {/* 基线 */}
      <line
        x1={PAD_X}
        y1={PAD_TOP + chartH}
        x2={WIDTH - PAD_X}
        y2={PAD_TOP + chartH}
        className="stroke-slate-200 dark:stroke-slate-700"
        strokeWidth={1}
      />
      {/* 上限参考线 */}
      <line
        x1={PAD_X}
        y1={PAD_TOP}
        x2={WIDTH - PAD_X}
        y2={PAD_TOP}
        className="stroke-slate-100 dark:stroke-slate-800"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <text x={PAD_X} y={PAD_TOP - 3} className="fill-slate-400 text-[10px] dark:fill-slate-500">
        {max}
      </text>

      {series.map((s) => {
        const points = s.values.map((v, i) => pointAt(i, v).join(',')).join(' ');
        return (
          <g key={s.label}>
            <polyline points={points} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
            {s.values.map((v, i) => {
              const [x, y] = pointAt(i, v);
              return <circle key={i} cx={x} cy={y} r={2.5} fill={s.color} />;
            })}
          </g>
        );
      })}

      {labels
        ? labels.map((label, i) =>
            i % Math.max(1, Math.round(count / 6)) === 0 ? (
              <text
                key={`${label}-${i}`}
                x={PAD_X + i * stepX}
                y={height - 6}
                textAnchor="middle"
                className="fill-slate-400 text-[10px] dark:fill-slate-500"
              >
                {label}
              </text>
            ) : null,
          )
        : null}
    </svg>
  );
}

export interface LineLegendProps {
  series: ReadonlyArray<Pick<LineSeries, 'label' | 'color'>>;
  className?: string;
}

/** 折线图图例 */
export function LineLegend({ series, className }: LineLegendProps): ReactNode {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400', className)}>
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}
