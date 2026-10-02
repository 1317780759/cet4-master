import type { ReactNode } from 'react';
import type { ExamSentence } from '@/domain/exam/types';
import type { Word } from '@/domain/word/types';
import { tierLabel } from '@/domain/word/tier';
import { Badge } from '@/ui/primitives';
import { cn } from '@/lib/cn';
import { ExamSentenceList } from './ExamSentenceList';
import { Phonetic } from './Phonetic';
import { SenseList } from './SenseList';

export interface WordCardProps {
  word: Word;
  /** 是否已翻卡（显示释义 / 例句） */
  revealed: boolean;
  /** 是否本次新引入的词 */
  isNew?: boolean;
  accent?: 'uk' | 'us';
  sentences?: readonly ExamSentence[];
  onReveal?: () => void;
  onPlay?: (accent: 'uk' | 'us') => void;
  onWordClick?: (wordId: string) => void;
  className?: string;
}

/**
 * 背词主卡 —— 全站最高频组件。
 * 大字 headword + 音标；释义默认遮蔽（点击 / 空格翻卡）；
 * 翻卡后展示释义、真卷词频、真题例句（语境高亮）。
 */
export function WordCard({
  word,
  revealed,
  isNew = false,
  accent = 'us',
  sentences = [],
  onReveal,
  onPlay,
  onWordClick,
  className,
}: WordCardProps): ReactNode {
  const interactive = Boolean(onReveal) && !revealed;

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onReveal : undefined}
      onKeyDown={
        interactive
          ? (event): void => {
              if (event.key === 'Enter') onReveal?.();
            }
          : undefined
      }
      className={cn(
        'rounded-md border border-slate-200 bg-surface p-5 dark:border-slate-800 dark:bg-slate-900',
        interactive && 'cursor-pointer transition-colors hover:border-brand-300',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isNew ? <Badge tone="info">新词</Badge> : <Badge tone="neutral">复习</Badge>}
          <Badge tone="neutral">{tierLabel(word.tier)}</Badge>
        </div>
        <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
          词频 #{word.freqRank}
        </span>
      </div>

      <h2 className="font-display mt-4 text-center text-5xl leading-tight text-slate-900 sm:text-6xl dark:text-slate-50">
        {word.headword}
      </h2>

      <Phonetic
        uk={word.phoneticUk}
        us={word.phoneticUs}
        accent={accent}
        onPlay={onPlay}
        className="mt-3 justify-center"
      />

      {revealed ? (
        <div className="mt-5 space-y-4">
          <SenseList senses={word.senses} size="lg" />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            真卷出现 {word.freqCount} 次
            {word.sentenceCount > 0 ? ` · ${word.sentenceCount} 条真题例句` : ''}
          </p>
          <ExamSentenceList
            sentences={sentences}
            onWordClick={onWordClick}
            emptyHint={
              word.sentenceCount > 0
                ? '例句加载中…'
                : '暂无真题例句（M1 提供渲染能力，例句语料属 M2 数据工作）'
            }
          />
        </div>
      ) : (
        <p className="mt-8 text-center text-sm text-slate-400 dark:text-slate-500">
          想一下它的意思，然后
          <span className="mx-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs dark:border-slate-600">
            点击
          </span>
          或按
          <span className="mx-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs dark:border-slate-600">
            Space
          </span>
          翻卡
        </p>
      )}
    </div>
  );
}
