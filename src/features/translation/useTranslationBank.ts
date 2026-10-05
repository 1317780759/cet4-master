import { useCallback, useEffect, useState } from 'react';
import { useDb } from '@/app/providers/DbProvider';
import { StaticJsonTranslationSource } from '@/data/sources/StaticJsonTranslationSource';
import { ensureTranslationsLoaded } from '@/data/loader/translationLoader';
import { countTranslations } from '@/data/repos/translationRepo';
import { describeError } from '@/lib/result';

/**
 * 翻译题库就绪 Hook —— 把「幂等灌库」这件事收敛到一处。
 *
 * ★ 为什么需要它：题库是**懒灌**的（不进首屏），所以第一次打开翻译页时
 *   `translations` 表可能是空的。若页面直接 `listTranslationsByTopic()`，
 *   用户会看到"没有句子"——一个被误读成"功能坏了"的空态。
 *   本 Hook 保证「数据到位」和「页面渲染」之间有明确的等待态。
 *
 * ★ 幂等由 `ensureTranslationsLoaded` 保证（比对 `meta['translationsVersion']`），
 *   因此同一会话内反复进出翻译页只会发**一次** index 请求；
 *   话题内容另有 `StaticJsonTranslationSource` 的内存缓存兜底。
 */

export type TranslationBankStatus = 'loading' | 'ready' | 'error';

export interface UseTranslationBankResult {
  status: TranslationBankStatus;
  /** 已入库句子总数；加载中或失败时为 0 */
  count: number;
  error: string | null;
  /** 手动重试（失败态才显示按钮） */
  reload: () => void;
}

/** 模块级单例：跨页面复用同一个 Source，话题内存缓存才能跨路由生效 */
let sharedSource: StaticJsonTranslationSource | null = null;

function translationSource(): StaticJsonTranslationSource {
  if (!sharedSource) sharedSource = new StaticJsonTranslationSource();
  return sharedSource;
}

/** 单测可注入假 Source */
export interface UseTranslationBankOptions {
  source?: { loadIndex: () => Promise<unknown>; loadTopic: (topic: string) => Promise<{ items: never[] }> };
}

export function useTranslationBank(options: UseTranslationBankOptions = {}): UseTranslationBankResult {
  const instance = useDb();
  const [status, setStatus] = useState<TranslationBankStatus>('loading');
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    void (async (): Promise<void> => {
      try {
        const source = (options.source ?? translationSource()) as Parameters<
          typeof ensureTranslationsLoaded
        >[0];
        await ensureTranslationsLoaded(source, instance);
        const total = await countTranslations(instance);
        if (cancelled) return;
        setCount(total);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(describeError(e));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [instance, attempt, options.source]);

  return { status, count, error, reload };
}