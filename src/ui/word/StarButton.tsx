import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface StarButtonProps {
  /** 是否已收藏 */
  starred: boolean;
  /** 点击切换（收藏 ↔ 取消） */
  onToggle: () => void;
  /** 无障碍标签前缀，通常传词条名 */
  label?: string;
  /** bordered = 带边框的独立按钮（卡片）；plain = 无边框（列表行内） */
  variant?: 'bordered' | 'plain';
  className?: string;
}

function StarIcon({ filled }: { filled: boolean }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('h-5 w-5', filled ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500')}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M12 4.5l2.3 4.9 5.2.7-3.8 3.7.9 5.4-4.6-2.5-4.6 2.5.9-5.4L4.5 10l5.2-.7z" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 收藏按钮 —— 全站唯一实现，三处 UI（背词卡 / 查词列表 / 词条详情）共用。
 *
 * ★ 需求 2 的修复要点：
 *   1. 以前查词页的收藏是**单向的**（已收藏就直接 return，点不动 → 永远取消不了）；
 *      这里统一为「点一下切换」，可收藏也可取消。
 *   2. 触控热区 44×44（min-h-11 / min-w-11），手机上点得中；
 *      以前查词页是 `px-2 text-lg` 的文字符号，实际热区不到 30px。
 */
export function StarButton({
  starred,
  onToggle,
  label,
  variant = 'bordered',
  className,
}: StarButtonProps): ReactNode {
  return (
    <button
      type="button"
      onClick={(event): void => {
        event.stopPropagation();
        onToggle();
      }}
      aria-label={starred ? `取消收藏${label ? ` ${label}` : ''}` : `收藏${label ? ` ${label}` : ''}`}
      aria-pressed={starred}
      className={cn(
        'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md touch-manipulation',
        'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
        variant === 'bordered'
          ? 'border border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800',
        className,
      )}
    >
      <StarIcon filled={starred} />
    </button>
  );
}
