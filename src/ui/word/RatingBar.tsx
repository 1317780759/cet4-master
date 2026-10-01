import type { ReactNode } from 'react';
import type { RatingInput } from '@/domain/fsrs/types';
import { cn } from '@/lib/cn';

export type SelfRating = RatingInput['self'];

export interface RatingBarProps {
  /** 是否显示（未翻卡时通常隐藏） */
  visible?: boolean;
  disabled?: boolean;
  /** 各档落点提示（如「10 分钟」） */
  hints?: Partial<Record<SelfRating, string>>;
  onRate: (self: SelfRating) => void;
  className?: string;
}

interface Option {
  self: SelfRating;
  label: string;
  keyHint: string;
  className: string;
}

/** 三个自评按钮 —— 移动端单手可及（底部大热区），桌面端标注键盘快捷键 */
const OPTIONS: Option[] = [
  {
    self: 'unknown',
    label: '不认识',
    keyHint: '↓',
    className:
      'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900',
  },
  {
    self: 'fuzzy',
    label: '模糊',
    keyHint: '←',
    className:
      'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900',
  },
  {
    self: 'known',
    label: '认识',
    keyHint: '→',
    className:
      'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900',
  },
];

export function RatingBar({
  visible = true,
  disabled = false,
  hints,
  onRate,
  className,
}: RatingBarProps): ReactNode {
  if (!visible) return null;

  return (
    <div className={cn('grid grid-cols-3 gap-2', className)} role="group" aria-label="自评">
      {OPTIONS.map((option) => (
        <button
          key={option.self}
          type="button"
          disabled={disabled}
          onClick={(): void => onRate(option.self)}
          className={cn(
            'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 font-medium transition-colors',
            'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            option.className,
          )}
        >
          <span className="text-base">{option.label}</span>
          <span className="text-[11px] opacity-70">
            {hints?.[option.self] ? `${hints[option.self]} · ` : ''}
            {option.keyHint}
          </span>
        </button>
      ))}
    </div>
  );
}
