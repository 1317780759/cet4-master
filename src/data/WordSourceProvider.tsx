import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StaticJsonWordSource } from './sources/StaticJsonWordSource';
import type { WordSource } from './sources/WordSource';

/**
 * 依赖注入容器（铁律 A3）。
 *
 * UI 与 service 层永远通过 `useWordSource()` 拿词库，
 * 因此换数据源（自建词频库 / 远程 CDN / 单测假源）只需在这里换一个实现。
 */

const WordSourceContext = createContext<WordSource | null>(null);

export interface WordSourceProviderProps {
  children: ReactNode;
  /** 不传则默认使用 `StaticJsonWordSource`（读 public/data） */
  source?: WordSource;
}

export function WordSourceProvider({ children, source }: WordSourceProviderProps): ReactNode {
  const value = useMemo<WordSource>(() => source ?? new StaticJsonWordSource(), [source]);
  return <WordSourceContext.Provider value={value}>{children}</WordSourceContext.Provider>;
}

export function useWordSource(): WordSource {
  const ctx = useContext(WordSourceContext);
  if (!ctx) {
    throw new Error('useWordSource 必须在 <WordSourceProvider> 内部使用');
  }
  return ctx;
}
