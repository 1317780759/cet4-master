import type { ReactNode } from 'react';
import type { ExamSentence } from '@/domain/exam/types';
import type { Word } from '@/domain/word/types';
import { tierLabel } from '@/domain/word/tier';
import { usePhonetic } from '@/hooks/usePhonetic';
import { Badge } from '@/ui/primitives';
import { cn } from '@/lib/cn';
import { ExamSentenceList } from './ExamSentenceList';
import { Phonetic } from './Phonetic';
import { SenseList } from './SenseList';
import { StarButton } from './StarButton';

export interface WordCardProps {
  word: Word;
  /** 是否已翻卡（显示释义 / 例句） */
  revealed: boolean;
  /** 是否本次新引入的词 */
  isNew?: boolean;
  accent?: 'uk' | 'us';
  sentences?: readonly ExamSentence[];
  /** 是否已收藏（生词本） */
  starred?: boolean;
  /** 切换收藏；不传则不显示收藏按钮 */
  onToggleStar?: () => void;
  onPlay?: (accent: 'uk' | 'us') => void;
  onWordClick?: (wordId: string) => void;
  className?: string;
}

/**
 * 背词主卡 —— 全站最高频组件。
 * 大字 headword + 音标；释义默认遮蔽，由**底部按钮**翻卡（空格键亦可）。
 *
 * ★ 需求 1 的手机端改动：
 *   - **删掉「点整张卡片翻卡」**。整卡可点在手机上极易误触，且与「点例句里的单词跳转」冲突。
 *     翻卡改由底部专门的按钮承担（≥44px 触控）。
 *   - 音标取运行时音标表（全量 5278 词，100% 覆盖），缺失时不渲染。
 *
 * ★ 需求 2：右上角常驻收藏按钮，翻卡前后都在，点一下即收藏/取消。
 */
export function WordCard({
  word,
  revealed,
  isNew = false,
  accent = 'us',
  sentences = [],
  starred = false,
  onToggleStar,
  onPlay,
  onWordClick,
  className,
}: WordCardProps): ReactNode {
  // 运行时音标（懒加载，未就绪时返回 null → 不渲染，绝不显示空占位）
  const runtime = usePhonetic(word.id);
  const uk = runtime?.uk || word.phoneticUk || undefined;
  const us = runtime?.us || word.phoneticUs || undefined;

  return (
    <div
      className={cn(
        'rounded-md border border-slate-200 bg-surface p-5 dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isNew ? <Badge tone="info">新词</Badge> : <Badge tone="neutral">复习</Badge>}
          <Badge tone="neutral">{tierLabel(word.tier)}</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onToggleStar ? (
            <StarButton starred={starred} onToggle={onToggleStar} label={word.headword} />
          ) : null}
          <span className="pl-1 text-xs text-slate-400 dark:text-slate-500">
            词频 #{word.freqRank}
          </span>
        </div>
      </div>

      <h2 className="font-display mt-4 text-center text-5xl leading-tight text-slate-900 sm:text-6xl dark:text-slate-50">
        {word.headword}
      </h2>

      <Phonetic
        uk={uk}
        us={us}
        accent={accent}
        onPlay={onPlay}
        className="mt-3"
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
          想一下它的意思，然后按下方
          <span className="mx-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs dark:border-slate-600">
            显示释义
          </span>
          翻卡（或按 Space）
        </p>
      )}
    </div>
  );
}
