import type { ReactNode } from 'react';
import type { ExamSentence } from '@/domain/exam/types';
import { cn } from '@/lib/cn';

export interface ExamSentenceListProps {
  sentences: readonly ExamSentence[];
  /** 点击高亮词 → 跳转该词详情（差异化②：语境 ↔ 单词双向反查） */
  onWordClick?: (wordId: string) => void;
  /** 无语料时的降级提示 */
  emptyHint?: ReactNode;
  /** 最多展示几条 */
  max?: number;
  className?: string;
}

interface Segments {
  before: string;
  target: string;
  after: string;
}

/**
 * 用 `span` 精确切分句子（**不用正则**，避免误伤同形词）。
 * span 越界或与 targetForm 不一致时，回退到 indexOf 定位；再不行则整句不高亮。
 */
export function splitBySpan(sentence: ExamSentence): Segments {
  const { en, span, targetForm } = sentence;
  const [rawStart, rawEnd] = span;
  const start = Math.max(0, Math.min(rawStart, en.length));
  const end = Math.max(start, Math.min(rawEnd, en.length));
  const bySpan = en.slice(start, end);
  if (bySpan === targetForm) {
    return { before: en.slice(0, start), target: bySpan, after: en.slice(end) };
  }
  const idx = en.toLowerCase().indexOf(targetForm.toLowerCase());
  if (idx >= 0) {
    return {
      before: en.slice(0, idx),
      target: en.slice(idx, idx + targetForm.length),
      after: en.slice(idx + targetForm.length),
    };
  }
  return { before: en, target: '', after: '' };
}

/**
 * 真题例句列表 —— M1 交付「渲染能力」：span 定位高亮 + 点击跳详情。
 * ★ 无例句语料时（M1 默认）优雅降级为一句提示，不阻塞背词主流程。
 */
export function ExamSentenceList({
  sentences,
  onWordClick,
  emptyHint,
  max = 5,
  className,
}: ExamSentenceListProps): ReactNode {
  if (sentences.length === 0) {
    return (
      <p className={cn('text-xs text-slate-400 dark:text-slate-500', className)}>
        {emptyHint ?? '暂无真题例句（M1 提供渲染能力，例句语料属 M2 数据工作）'}
      </p>
    );
  }

  return (
    <ul className={cn('space-y-3', className)}>
      {sentences.slice(0, max).map((sentence) => {
        const seg = splitBySpan(sentence);
        return (
          <li key={sentence.id} className="border-l-2 border-brand-200 pl-3 dark:border-brand-800">
            <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-100">
              {seg.before}
              {seg.target ? (
                <mark
                  role={onWordClick ? 'button' : undefined}
                  tabIndex={onWordClick ? 0 : undefined}
                  onClick={
                    onWordClick
                      ? (): void => onWordClick(sentence.wordId)
                      : undefined
                  }
                  onKeyDown={
                    onWordClick
                      ? (event): void => {
                          if (event.key === 'Enter' || event.key === ' ') onWordClick(sentence.wordId);
                        }
                      : undefined
                  }
                  className={cn(
                    'rounded bg-amber-100 px-0.5 font-semibold text-amber-900',
                    'dark:bg-amber-900/50 dark:text-amber-100',
                    onWordClick && 'cursor-pointer hover:bg-amber-200 dark:hover:bg-amber-800/60',
                  )}
                >
                  {seg.target}
                </mark>
              ) : null}
              {seg.after}
            </p>
            {sentence.zh ? (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sentence.zh}</p>
            ) : null}
            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
              {sentence.paperId}
              {sentence.questionNo !== undefined ? ` · 第 ${sentence.questionNo} 题` : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
