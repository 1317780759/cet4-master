import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { WordSource } from '@/data/sources/WordSource';
import { loadedChunks } from '@/data/repos/wordRepo';
import { loadChunkIntoDb } from './chunkLoader';

export interface WarmOptions {
  /** 省流量模式 / 用户关闭预取时为 false —— 直接不启动 */
  enabled: boolean;
  /** 本次最多预取的分片数（默认 3，对应实现方案「后台预热 3 片」） */
  maxChunks?: number;
  /** 每片完成回调 */
  onChunkLoaded?: (chunkIndex: number, words: number) => void;
  /** 全部完成或出错回调 */
  onDone?: (loaded: number[]) => void;
}

type IdleHandle = { cancel: () => void };

/** requestIdleCallback 的类型兜底（Safari 老版本没有） */
interface IdleScheduler {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** 定时器句柄：浏览器是 number，Node 下是 Timeout —— 用返回类型统一 */
type TimerHandle = ReturnType<typeof setTimeout>;

function scheduleIdle(fn: () => void): TimerHandle | null {
  const w = globalThis as unknown as IdleScheduler;
  if (typeof w.requestIdleCallback === 'function') {
    return w.requestIdleCallback(fn, { timeout: 2_000 }) as unknown as TimerHandle;
  }
  return globalThis.setTimeout(fn, 300);
}

function cancelIdle(handle: TimerHandle | null, usedIdle: boolean): void {
  if (handle === null) return;
  const w = globalThis as unknown as IdleScheduler;
  if (usedIdle && typeof w.cancelIdleCallback === 'function') {
    w.cancelIdleCallback(handle as unknown as number);
    return;
  }
  if (!usedIdle) globalThis.clearTimeout(handle);
}

/**
 * 后台预热：空闲时按词频顺序（chunk 序号升序）预取后续分片。
 *
 * - 只在浏览器空闲时跑，不抢首屏资源
 * - `enabled=false`（省流量模式）时完全不启动
 * - 返回 cancel()，路由卸载 / 用户关预取时调用
 */
export function warmChunks(
  instance: Cet4Database = defaultDb,
  source: WordSource,
  options: WarmOptions,
): IdleHandle {
  const maxChunks = options.maxChunks ?? 3;
  if (!options.enabled) {
    options.onDone?.([]);
    return { cancel: (): void => undefined };
  }

  let cancelled = false;
  const loaded: number[] = [];

  const runNext = (): void => {
    if (cancelled) return;
    void (async (): Promise<void> => {
      const handle: TimerHandle | null = null;
      const usedIdle = typeof (globalThis as unknown as IdleScheduler).requestIdleCallback === 'function';
      try {
        const total = source.chunkCount() ?? 0;
        if (total <= 1) {
          options.onDone?.(loaded);
          return;
        }
        const done = new Set(await loadedChunks(instance));
        const pending: number[] = [];
        for (let i = 2; i <= total && pending.length < maxChunks; i += 1) {
          if (!done.has(i)) pending.push(i);
        }
        if (pending.length === 0) {
          options.onDone?.(loaded);
          return;
        }
        for (const index of pending) {
          if (cancelled) return;
          const count = await loadChunkIntoDb(instance, source, index);
          loaded.push(index);
          options.onChunkLoaded?.(index, count);
        }
        options.onDone?.(loaded);
      } catch {
        // 预取失败不影响主流程：静默结束，下次启动会自然重试
        options.onDone?.(loaded);
      } finally {
        cancelIdle(handle, usedIdle);
      }
    })();
  };

  const initial = scheduleIdle(runNext);
  const usedIdleInitial = typeof (globalThis as unknown as IdleScheduler).requestIdleCallback === 'function';

  return {
    cancel: (): void => {
      cancelled = true;
      cancelIdle(initial, usedIdleInitial);
    },
  };
}
