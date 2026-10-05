import { useEffect, useState } from 'react';
import { ensurePhonetics, getPhonetic, type PhoneticEntry } from '@/services/phonetics';

/**
 * 取某个词的音标（懒加载 + 内存缓存）。
 *
 * ★ 契约：返回 `PhoneticEntry | null`。**null 是正常状态，不是错误** ——
 *   未加载 / 加载失败 / 该词恰好无音标，三种情况都返回 null，上层一律不渲染。
 */
export function usePhonetic(wordId: string | null | undefined): PhoneticEntry | null {
  const [entry, setEntry] = useState<PhoneticEntry | null>(() =>
    wordId ? getPhonetic(wordId) : null,
  );

  useEffect(() => {
    if (!wordId) {
      setEntry(null);
      return;
    }
    const cached = getPhonetic(wordId);
    if (cached) {
      setEntry(cached);
      return;
    }
    let cancelled = false;
    void ensurePhonetics().then((): void => {
      if (!cancelled) setEntry(getPhonetic(wordId));
    });
    return (): void => {
      cancelled = true;
    };
  }, [wordId]);

  return entry;
}
