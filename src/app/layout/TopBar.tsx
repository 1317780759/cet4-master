import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/app/providers/ThemeProvider';
import { cn } from '@/lib/cn';

const ICON_BTN = cn(
  'inline-flex h-9 w-9 items-center justify-center rounded-md',
  'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
);

function SearchIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="6.2" />
      <path d="m15.6 15.6 4 4" />
    </svg>
  );
}

function SunIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </svg>
  );
}

function MoonIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
    </svg>
  );
}

/** 顶部栏：品牌 + 查词 + 主题切换（深浅色，PRD R09） */
export function TopBar(): ReactNode {
  const { resolved, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-14 items-center justify-between gap-2 px-4',
        'border-b border-slate-200 bg-surface/95 backdrop-blur',
        'dark:border-slate-800 dark:bg-slate-900/95',
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[17px] leading-none text-slate-900 dark:text-slate-50">
          CET-4 Master
        </span>
        <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
          词频优先 · 真题语境
        </span>
      </div>

      <div className="flex items-center gap-1">
        {/* 查词是高频动作，放在顶栏常驻 —— 不用先回首页再找入口 */}
        <button
          type="button"
          onClick={(): void => { void navigate('/search'); }}
          aria-label="查词"
          className={ICON_BTN}
        >
          <SearchIcon />
        </button>

        <button
          type="button"
          onClick={toggle}
          aria-label={resolved === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          className={ICON_BTN}
        >
          {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}
