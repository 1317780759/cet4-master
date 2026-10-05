import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cet4Database } from '@/data/db/db';
import { addVocab, findVocab, removeVocab } from '@/data/repos/vocabRepo';

export interface UseVocabToggle {
  /** 是否已收藏（生词本中存在） */
  starred: boolean;
  /** 切换收藏；返回切换后的状态，便于调用方弹提示 */
  toggle: () => Promise<boolean>;
}

/**
 * 收藏 / 取消收藏（生词本）。
 *
 * ★ 为什么要有这个 hook：收藏逻辑原本散落在查词页与详情页，且查词页的实现是**单向的**
 *   （`if (starred.has(word.id)) return;` —— 已收藏就点不动，无法取消）。背词卡片上
 *   则完全没有入口。收敛到一处，三处 UI 共用同一语义。
 *
 * ★ 收藏不进 FSRS 队列、不影响学习进度 —— 它只是「主动标记」。
 */
export function useVocabToggle(
  wordId: string | null | undefined,
  instance?: Cet4Database,
): UseVocabToggle {
  const [starred, setStarred] = useState(false);
  // 切词时防止上一次查询的结果盖掉新词的状态
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!wordId) {
      setStarred(false);
      return;
    }
    const token = ++tokenRef.current;
    setStarred(false);
    void findVocab(wordId, instance).then((row): void => {
      if (token === tokenRef.current) setStarred(Boolean(row));
    });
  }, [wordId, instance]);

  const toggle = useCallback(async (): Promise<boolean> => {
    if (!wordId) return false;
    const next = !starred;
    // 先更新 UI（乐观），再落库；失败则回滚
    setStarred(next);
    try {
      if (next) await addVocab({ wordId }, instance);
      else await removeVocab(wordId, instance);
      return next;
    } catch {
      setStarred(!next);
      return !next;
    }
  }, [wordId, starred, instance]);

  return { starred, toggle };
}
