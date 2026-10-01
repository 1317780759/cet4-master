import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PhoneticProps {
  uk?: string;
  us?: string;
  /** 当前口音（高亮对应项） */
  accent?: 'uk' | 'us';
  /** 点击发音 */
  onPlay?: (accent: 'uk' | 'us') => void;
  className?: string;
}

/**
 * 音标展示 —— 英 / 美双音标，点击喇叭发音。
 * 无音标数据时优雅隐藏（不显示空占位）。
 */
export function Phonetic({ uk, us, accent = 'us', onPlay, className }: PhoneticProps): ReactNode {
  if (!uk && !us) return null;
  const items: Array<{ key: 'uk' | 'us'; label: string; value?: string }> = [
    { key: 'uk', label: '英', value: uk },
    { key: 'us', label: '美', value: us },
  ];
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {items
        .filter((item) => Boolean(item.value))
        .map((item) => (
          <div
            key={item.key}
            className={cn(
              'flex items-center gap-1 text-sm',
              accent === item.key
                ? 'text-slate-700 dark:text-slate-200'
                : 'text-slate-400 dark:text-slate-500',
            )}
          >
            <span className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{item.label}</span>
            <span className="font-mono">{item.value}</span>
            {onPlay ? (
              <button
                type="button"
                onClick={(event): void => {
                  event.stopPropagation();
                  onPlay(item.key);
                }}
                aria-label={`播放${item.label}音`}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                🔊
              </button>
            ) : null}
          </div>
        ))}
    </div>
  );
}
