import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/* 小标签做成"细边小牌"：圆角收到 3px、加描边，比一水儿的圆角胶囊更像印刷品 */
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral:
    'border border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  info: 'border border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-900 dark:text-brand-200',
  success:
    'border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  warning:
    'border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-300',
  danger:
    'border border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-900 dark:text-red-200',
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', children, className }: BadgeProps): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] px-1.5 py-px text-[11px] font-medium tracking-wide',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
