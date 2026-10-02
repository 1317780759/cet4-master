import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** 块级（移动端主要按钮） */
  block?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  /* 主按钮：朱红实底 + 一道更深的边，像盖了个章 */
  primary:
    'border border-brand-700 bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:border-brand-300 disabled:bg-brand-300 dark:disabled:border-brand-800 dark:disabled:bg-brand-800',
  /* 次按钮：描边而非灰底 —— 一堆灰底按钮会让界面糊成一片 */
  secondary:
    'border border-slate-300 bg-surface text-slate-800 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800',
  ghost:
    'border border-transparent bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
  danger: 'border border-red-700 bg-red-600 text-white hover:bg-red-700 active:bg-red-700',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

/** 自研按钮：无第三方 UI 库依赖，深浅色双模 */
export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  disabled,
  children,
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type={rest.type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        block && 'w-full',
        className,
      )}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** 内联加载指示器（避免为一个小圈引入图标库） */
export function Spinner({ className }: { className?: string }): ReactNode {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      aria-hidden="true"
    />
  );
}
