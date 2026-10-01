import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ProgressProps {
  /** 0..1 */
  value: number;
  /** 无障碍标签 */
  label?: string;
  /** 是否显示百分比文字 */
  showValue?: boolean;
  className?: string;
}

/** 进度条 —— 首次数据加载门的核心反馈组件 */
export function Progress({
  value,
  label = '加载进度',
  showValue = false,
  className,
}: ProgressProps): ReactNode {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={cn('w-full', className)}>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-300 ease-out dark:bg-brand-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showValue ? (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{pct}%</p>
      ) : null}
    </div>
  );
}
