import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** 置灰但仍可选（如"该档位尚未加载"） */
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** 无障碍标签（必填：一组分段控件需要一个组名） */
  ariaLabel: string;
  size?: 'sm' | 'md';
  /** 占满容器宽度（移动端更好按） */
  block?: boolean;
  className?: string;
}

/**
 * 分段选择器 —— 取代下拉框：选项 ≤4 个时一次点击直达，不用展开。
 * 键盘可达：用原生 button + aria-pressed，Tab/Enter 天然可用。
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  block = false,
  className,
}: SegmentedProps<T>): ReactNode {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900',
        block && 'flex w-full',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            disabled={opt.disabled === true}
            onClick={(): void => onChange(opt.value)}
            className={cn(
              'rounded-md font-medium transition-colors',
              'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50',
              block ? 'flex-1' : '',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active
                ? 'border border-brand-300 bg-surface text-brand-700 dark:border-brand-700 dark:bg-slate-800 dark:text-brand-200'
                : 'border border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
