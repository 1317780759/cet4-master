import type { ReactNode } from 'react';
import type { Pos, WordSense } from '@/domain/word/types';
import { cn } from '@/lib/cn';

/** 词性中文简写（当前数据源多不标词性，故含 unknown） */
const POS_LABEL: Record<Pos, string> = {
  n: 'n.',
  v: 'v.',
  adj: 'adj.',
  adv: 'adv.',
  prep: 'prep.',
  conj: 'conj.',
  pron: 'pron.',
  num: 'num.',
  art: 'art.',
  int: 'int.',
  unknown: '',
};

export interface SenseListProps {
  senses: readonly WordSense[];
  /** 大字模式（背词页翻卡后使用） */
  size?: 'md' | 'lg';
  className?: string;
}

/** 释义列表 —— 按词性分组，字号可切换 */
export function SenseList({ senses, size = 'md', className }: SenseListProps): ReactNode {
  if (senses.length === 0) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">（暂无释义）</p>;
  }

  const groups = new Map<Pos, string[]>();
  for (const sense of senses) {
    const list = groups.get(sense.pos) ?? [];
    list.push(sense.zh);
    groups.set(sense.pos, list);
  }

  return (
    <ul className={cn('space-y-1.5', className)}>
      {[...groups.entries()].map(([pos, zhList]) => (
        <li key={pos} className="flex gap-2">
          {POS_LABEL[pos] ? (
            <span
              className={cn(
                'mt-0.5 shrink-0 font-medium text-brand-600 dark:text-brand-400',
                size === 'lg' ? 'text-base' : 'text-sm',
              )}
            >
              {POS_LABEL[pos]}
            </span>
          ) : null}
          <span
            className={cn(
              'text-slate-800 dark:text-slate-100',
              size === 'lg' ? 'text-xl leading-relaxed' : 'text-base',
            )}
          >
            {zhList.join('；')}
          </span>
        </li>
      ))}
    </ul>
  );
}
