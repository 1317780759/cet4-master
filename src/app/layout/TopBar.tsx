import type { ReactNode } from 'react';
import { useTheme } from '@/app/providers/ThemeProvider';
import { cn } from '@/lib/cn';

/** 顶部栏：品牌 + 主题切换（深浅色，PRD R09） */
export function TopBar(): ReactNode {
  const { resolved, toggle } = useTheme();

  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-14 items-center justify-between gap-2 px-4',
        'border-b border-slate-200 bg-white/90 backdrop-blur',
        'dark:border-slate-800 dark:bg-slate-900/90',
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold text-slate-900 dark:text-slate-50">
          CET-4 Master
        </span>
        <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
          词频优先 · 真题语境
        </span>
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label={resolved === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-lg text-sm',
          'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
        )}
      >
        {resolved === 'dark' ? '☀' : '☾'}
      </button>
    </header>
  );
}
