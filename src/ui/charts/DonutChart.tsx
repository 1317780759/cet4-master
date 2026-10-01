import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  segments: readonly DonutSegment[];
  size?: number;
  thickness?: number;
  centerValue?: string;
  centerTitle?: string;
  className?: string;
}

/**
 * 自研环形图（掌握度分布）—— 纯 SVG，零依赖。
 */
export function DonutChart({
  segments,
  size = 160,
  thickness = 20,
  centerValue,
  centerTitle,
  className,
}: DonutChartProps): ReactNode {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) {
    return <p className={cn('text-sm text-slate-400 dark:text-slate-500', className)}>暂无数据</p>;
  }

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  let offset = 0;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="掌握度分布">
      <g transform={`rotate(-90 ${center} ${center})`}>
        {segments.map((segment) => {
          const fraction = Math.max(0, segment.value) / total;
          const length = fraction * circumference;
          const dash = `${length} ${circumference - length}`;
          const element = (
            <circle
              key={segment.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return element;
        })}
      </g>
      {centerValue ? (
        <text
          x={center}
          y={center - 2}
          textAnchor="middle"
          className="fill-slate-800 text-lg font-semibold dark:fill-slate-100"
        >
          {centerValue}
        </text>
      ) : null}
      {centerTitle ? (
        <text
          x={center}
          y={center + 16}
          textAnchor="middle"
          className="fill-slate-400 text-[11px] dark:fill-slate-500"
        >
          {centerTitle}
        </text>
      ) : null}
    </svg>
  );
}

/** 环形图图例 */
export function DonutLegend({
  segments,
  className,
}: {
  segments: readonly DonutSegment[];
  className?: string;
}): ReactNode {
  return (
    <ul className={cn('space-y-1 text-xs text-slate-600 dark:text-slate-300', className)}>
      {segments.map((segment) => (
        <li key={segment.label} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
          <span className="flex-1">{segment.label}</span>
          <span className="font-medium tabular-nums">{segment.value}</span>
        </li>
      ))}
    </ul>
  );
}
