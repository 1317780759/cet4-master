import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDb } from '@/app/providers/DbProvider';
import { ensurePaper } from '@/data/loader/paperLoader';
import { BuiltinPaperSource } from '@/data/sources/BuiltinPaperSource';
import type { PaperBundle } from '@/data/sources/PaperSource';
import { buildSectionPlan } from '@/domain/exam/sectionPlan';
import type { ExamResultView } from '@/domain/exam/result';
import { ExamSession } from '@/services/examSession';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/ui/primitives';
import { ExamRunner } from './ExamRunner';
import { ExamResultPanel } from './ExamResultPanel';

/**
 * 真题练习入口（/mock?paper=<id>）。
 *
 * ★ 时长与板块**全部**由 `buildSectionPlan(paper)` 推导（K1/K2），本文件不出现
 *   任何板块名数组或硬编码分钟数 —— 将来恢复听力只需改 `DEFAULT_DISABLED_SECTIONS`。
 * ★ 断点续考：同一套卷若存在未交卷的 attempt，直接恢复而不是重开一场
 *   （否则用户刷新一下进度就丢了）。
 */

type Phase = 'loading' | 'running' | 'result' | 'error';

export default function MockExamPage(): ReactNode {
  const instance = useDb();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const paperId = params.get('paper') ?? '';

  const mockStrictTiming = useSettingsStore((s) => s.settings.mockStrictTiming);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);

  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<ExamSession | null>(null);
  const [bundle, setBundle] = useState<PaperBundle | null>(null);
  const [view, setView] = useState<ExamResultView | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrateSettings();
  }, [hydrateSettings]);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);

    void (async (): Promise<void> => {
      if (!paperId) {
        if (!cancelled) {
          setError('未指定套卷');
          setPhase('error');
        }
        return;
      }
      try {
        const { bundle: loaded } = await ensurePaper(paperId, new BuiltinPaperSource(), instance);
        const plan = buildSectionPlan(loaded.paper);

        // 断点续考：先找这场卷有没有未交卷的记录
        const ongoing = await instance.attempts
          .filter((a) => a.paperId === paperId && a.status === 'ongoing')
          .first();
        const resumed = ongoing ? await ExamSession.resume(ongoing.id, { db: instance }) : undefined;
        const next = resumed ?? (await ExamSession.start({ paperId, mode: 'practice', plan, untimed: !mockStrictTiming }, { db: instance }));

        if (cancelled) return;
        setBundle(loaded);
        setSession(next);
        setPhase('running');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '加载套卷失败');
        setPhase('error');
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, [paperId, instance, mockStrictTiming]);

  const handleSubmit = useCallback(
    (reason: 'manual' | 'auto'): void => {
      if (!session) return;
      void session.submit(reason).then((result): void => {
        setView(result.view);
        setAutoSubmitted(reason === 'auto');
        setPhase('result');
      });
    },
    [session],
  );

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        正在准备这套卷…
      </div>
    );
  }

  if (phase === 'error' || !session || !bundle) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>无法开始练习</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm">{error ?? '未知错误'}</p>
            <Button onClick={(): void => { void navigate('/papers'); }}>去选一套卷</Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (phase === 'result' && view) {
    return <ExamResultPanel view={view} autoSubmitted={autoSubmitted} />;
  }

  return <ExamRunner session={session} bundle={bundle} onSubmit={handleSubmit} />;
}
