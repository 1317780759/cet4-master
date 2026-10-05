import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDb } from '@/app/providers/DbProvider';
import {
  listTranslationsByTopic,
  listUnresolvedTranslationBook,
} from '@/data/repos/translationRepo';
import { TRANSLATION_TOPIC_LABEL, TRANSLATION_TOPIC_KEYS } from '@/domain/translation/topics';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from '@/ui/primitives';
import { useTranslationBank } from './useTranslationBank';
import { cn } from '@/lib/cn';

/**
 * 输出训练首页 —— 15 个话题入口 + 错句本出口。
 *
 * ★ 这一页刻意**不放**一级Tab（docs/04b §5.8 选项 A）：
 *   翻译训练是"想起来才用"的功能（不像背词有每日打卡压力），
 *   占掉一个一级位置会挤掉真正每天都要用的复习。
 */

interface TopicStat {
  key: string;
  count: number;
}

export default function TranslationHomePage(): ReactNode {
  const instance = useDb();
  const navigate = useNavigate();
  const bank = useTranslationBank();

  const [stats, setStats] = useState<TopicStat[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  const reload = useCallback((): void => {
    void (async (): Promise<void> => {
      const rows = await Promise.all(
        TRANSLATION_TOPIC_KEYS.map(async (key) => ({
          key,
          count: (await listTranslationsByTopic(key, instance)).length,
        })),
      );
      setStats(rows);
      setPendingCount((await listUnresolvedTranslationBook(instance)).length);
    })();
  }, [instance]);

  useEffect(() => {
    if (bank.status !== 'ready') return;
    reload();
  }, [bank.status, reload]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
      <div>
        <h1 className="font-display text-xl text-slate-900 dark:text-slate-50">输出训练</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          词语 → 句子，写完就有反馈。全部离线可用。
        </p>
      </div>

      {bank.status === 'loading' ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-400 dark:text-slate-500">正在准备题库…</p>
          </CardBody>
        </Card>
      ) : null}

      {bank.status === 'error' ? (
        <Card>
          <CardHeader>
            <CardTitle>题库加载失败</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-red-700 dark:text-red-300">{bank.error}</p>
            <Button block variant="secondary" onClick={bank.reload}>
              重试
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {bank.status === 'ready' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>快速开始</CardTitle>
              <Badge tone="neutral">题库 {bank.count} 句</Badge>
            </CardHeader>
            <CardBody className="space-y-2">
              <Button block onClick={(): void => void navigate('/translation/practice?mode=random&count=10')}>
                随机来 10 句
              </Button>
              <div className="flex gap-2">
                <Button
                  block
                  variant="secondary"
                  disabled={pendingCount === 0}
                  onClick={(): void => void navigate('/translation/practice?mode=review&count=10')}
                >
                  错句重做{pendingCount > 0 ? `（${pendingCount}）` : ''}
                </Button>
                <Button block variant="secondary" onClick={(): void => void navigate('/translation/book')}>
                  错句本
                </Button>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                随机模式会跨全部话题打散，不会连着来一整段同一话题。
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>按话题练</CardTitle>
              <span className="text-xs text-slate-400 dark:text-slate-500">15 个四级常考话题</span>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TRANSLATION_TOPIC_KEYS.map((key) => {
                  const count = stats.find((s) => s.key === key)?.count ?? 0;
                  return (
                    <Link
                      key={key}
                      to={`/translation/practice?mode=topic&topic=${encodeURIComponent(key)}&count=10`}
                      className={cn(
                        'flex min-h-11 flex-col justify-center rounded-md border border-slate-300 bg-surface px-3 py-2 transition-colors touch-manipulation',
                        'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                        'hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
                      )}
                    >
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {TRANSLATION_TOPIC_LABEL[key]}
                      </span>
                      <span className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                        {count} 句
                      </span>
                    </Link>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          <p className="text-xs text-slate-400 dark:text-slate-500">
            题目与参考译文均为本项目自撰（不含任何真题原文），评分档位仅供练习参考，不代表四级官方评分。
          </p>
        </>
      ) : null}
    </div>
  );
}