import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  info: 'bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-200',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  danger: 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-200',
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
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
