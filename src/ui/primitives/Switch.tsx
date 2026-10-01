import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 主标题 */
  label: string;
  /** 副标题：说明这个开关**影响什么**，避免"开关一堆但不知道在开什么" */
  description?: string;
  disabled?: boolean;
}

/**
 * 开关 —— 原生 checkbox + role=switch，键盘与读屏均可用。
 * ★ 刻意要求传 description：设置项若没有说明，用户改了也不知道会怎样。
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: SwitchProps): ReactNode {
  return (
    <label
      className={cn(
        'flex items-start justify-between gap-3 py-2',
        disabled ? 'opacity-60' : '',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            {description}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={(): void => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none',
          checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}
