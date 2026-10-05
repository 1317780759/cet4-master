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

function SpeakerIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z" strokeLinejoin="round" />
      <path d="M15.5 9a4 4 0 0 1 0 6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 音标展示 —— 英 / 美双音标，整块可点发音。
 *
 * ★ 手机端要点：整块 chip 就是按钮，触控高度 44px（原来只有 24px 的 🔊 图标，
 *   手机上根本点不中）。点 chip 任意位置即朗读对应口音。
 *
 * ★ 只显示**真实存在**的方言：缺哪一侧就少一块，绝不用美音冒充英音。
 *   无音标时整体不渲染（不显示空占位、不显示 —）。
 */
export function Phonetic({ uk, us, accent = 'us', onPlay, className }: PhoneticProps): ReactNode {
  if (!uk && !us) return null;

  const items: Array<{ key: 'uk' | 'us'; label: string; value?: string }> = [
    { key: 'uk', label: '英', value: uk },
    { key: 'us', label: '美', value: us },
  ];
  const shown = items.filter((item) => Boolean(item.value));
  if (shown.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-2', className)}>
      {shown.map((item) => {
        const active = accent === item.key;
        const body = (
          <>
            <span className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{item.label}</span>
            <span className="font-mono text-sm">/{item.value}/</span>
            {onPlay ? <SpeakerIcon /> : null}
          </>
        );
        const base = 'inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors';
        if (!onPlay) {
          return (
            <span
              key={item.key}
              className={cn(
                base,
                'border-transparent',
                active ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500',
              )}
            >
              {body}
            </span>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            onClick={(event): void => {
              event.stopPropagation();
              onPlay(item.key);
            }}
            aria-label={`播放${item.label}音 /${item.value}/`}
            className={cn(
              base,
              'touch-manipulation',
              active
                ? 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
                : 'border-slate-200 text-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-500 dark:hover:bg-slate-800',
            )}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
