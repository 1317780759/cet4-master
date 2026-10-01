import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDb } from './DbProvider';
import { useWordSource } from '@/data/WordSourceProvider';
import { ensureWordbank, type LoadProgress } from '@/data/loader/chunkLoader';
import { warmChunks } from '@/data/loader/cacheWarmer';
import { getSettings } from '@/data/repos/settingsRepo';
import { describeError } from '@/lib/result';
import { Button, Card, Progress } from '@/ui/primitives';

export type BootstrapPhase = 'checking' | 'downloading' | 'ready' | 'error';

export interface BootstrapGateProps {
  children: ReactNode;
}

const INITIAL_PROGRESS: LoadProgress = { phase: 'idle', message: '正在启动', ratio: 0 };

/**
 * ★ 首次数据加载进度门（含失败重试）。
 *
 * 流程：读 manifest → 比对本地 dataVersion
 *   - 一致 → 直接放行（**零词库请求**，第二次访问走这条）
 *   - 不一致 → 清镜像区 → 灌索引 → 灌首片 → 放行
 *     （全程只碰 MIRROR_STORES，用户进度不受影响）
 * 放行后在空闲时段由 cacheWarmer 预取后续分片。
 */
export function BootstrapGate({ children }: BootstrapGateProps): ReactNode {
  const source = useWordSource();
  const instance = useDb();

  const [progress, setProgress] = useState<LoadProgress>(INITIAL_PROGRESS);
  const [phase, setPhase] = useState<BootstrapPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const warmHandle = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase('checking');
    setError(null);

    void (async (): Promise<void> => {
      try {
        await ensureWordbank(instance, source, {
          // 重试时强制重灌：上次可能是写了一半的脏状态
          force: attempt > 0,
          onProgress: (p) => {
            if (cancelled) return;
            setProgress(p);
            setPhase(p.phase === 'done' ? 'ready' : 'downloading');
          },
        });
        if (cancelled) return;
        setPhase('ready');

        const settings = await getSettings(instance);
        if (cancelled) return;
        if (settings.prefetchEnabled) {
          warmHandle.current?.cancel();
          warmHandle.current = warmChunks(instance, source, { enabled: true });
        }
      } catch (e) {
        if (cancelled) return;
        setError(describeError(e));
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      warmHandle.current?.cancel();
    };
  }, [instance, source, attempt]);

  const retry = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

  if (phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <h2 className="mb-2 text-base font-semibold text-slate-800 dark:text-slate-100">
            词库加载失败
          </h2>
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{error}</p>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            数据保存在你自己的浏览器里，重试不会丢失已有的学习进度。
          </p>
          <Button onClick={retry} block>
            重试
          </Button>
        </Card>
      </div>
    );
  }

  if (phase !== 'ready') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <div className="w-full max-w-sm">
          <p className="mb-2 text-center text-sm font-medium text-slate-700 dark:text-slate-200">
            {progress.message}
          </p>
          <Progress value={progress.ratio} label="词库加载进度" showValue />
          <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500">
            首次使用需要下载词库（约 1–2 MB），之后均为离线访问
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
