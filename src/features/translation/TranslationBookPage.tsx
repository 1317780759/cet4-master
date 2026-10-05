import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDb } from '@/app/providers/DbProvider';
import type { TranslationBookRow } from '@/data/db/rows';
import {
  getTranslation,
  listTranslationBook,
  markTranslationResolved,
  removeTranslationBookRow,
} from '@/data/repos/translationRepo';
import { translationTopicLabel } from '@/domain/translation/topics';
import type { TranslationItem } from '@/domain/translation/types';
import { bandLabel } from './components/DualScoreCard';
import { formatRelative } from '@/lib/date';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Segmented } from '@/ui/primitives';

/**
 * 错句本 —— 翻译训练的"记忆闭环"末端。
 *
 * ★ 与错词本同构的设计取舍：只存**需要重做**的句（命中率 < 80%），
 *   连续答对后自动归档（`resolved = true`），所以它会收敛而不是越积越多。
 *   一个只会变长的清单最终没人会打开 —— 那还不如不给这个功能。
 */

type Tab = 'pending' | 'archived';

export default function TranslationBookPage(): ReactNode {
  const instance = useDb();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('pending');
  const [rows, setRows] = useState<TranslationBookRow[]>([]);
  const [items, setItems] = useState<Map<string, TranslationItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<number>(() => Date.now());

  const reload = useCallback((): void => {
    void (async (): Promise<void> => {
      setLoading(true);
      const list = await listTranslationBook(instance);
      setRows(list);
      // ★ 只批量取当前页要显示的那些条目，避免为归档区白拉一次数据
      const visible = list.filter((row) => (tab === 'pending' ? !row.resolved : row.resolved));
      const loaded = await Promise.all(visible.map((row) => getTranslation(row.itemId, instance)));
      const map = new Map<string, TranslationItem>();
      loaded.forEach((item) => {
        if (item) map.set(item.id, item);
      });
      setItems(map);
      setNow(Date.now());
      setLoading(false);
    })();
  }, [instance, tab]);

  useEffect(reload, [reload]);

  const visible = rows.filter((row) => (tab === 'pending' ? !row.resolved : row.resolved));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl text-slate-900 dark:text-slate-50">错句本</h1>
        <Button size="sm" variant="ghost" onClick={(): void => void navigate('/translation')}>
          返回
        </Button>
      </div>

      <Segmented
        ariaLabel="错句本分组"
        block
        options={[
          { value: 'pending', label: `待重做（${rows.filter((r) => !r.resolved).length}）` },
          { value: 'archived', label: `已掌握（${rows.filter((r) => r.resolved).length}）` },
        ]}
        value={tab}
        onChange={(v): void => setTab(v as Tab)}
      />

      <Card>
        <CardHeader>
          <CardTitle>{tab === 'pending' ? '还没掌握的句子' : '已归档'}</CardTitle>
          <Badge tone="neutral">{visible.length} 句</Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          {tab === 'pending' && visible.length > 0 ? (
            <Button block onClick={(): void => void navigate('/translation/practice?mode=review&count=10')}>
              重做这些句子
            </Button>
          ) : null}

          {loading ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">加载中…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              {tab === 'pending'
                ? '这里是空的 —— 命中率不到 80% 的句子会自动收进来。'
                : '还没有归档的句子。'}
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((row) => (
                <BookRow
                  key={row.id ?? row.itemId}
                  row={row}
                  item={items.get(row.itemId)}
                  now={now}
                  onChanged={reload}
                  instance={instance}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function BookRow({
  row,
  item,
  now,
  onChanged,
  instance,
}: {
  row: TranslationBookRow;
  item: TranslationItem | undefined;
  now: number;
  onChanged: () => void;
  instance: ReturnType<typeof useDb>;
}): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-slate-100 pb-3 last:border-0 last:pb-0 dark:border-slate-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{translationTopicLabel(row.topic)}</Badge>
            {row.lastScore ? (
              <Badge tone="danger">
                命中 {row.lastScore.hit}/{row.lastScore.total} · {bandLabel(row.lastScore.band)}
              </Badge>
            ) : null}
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {formatRelative(row.lastTriedAt ?? row.addedAt, now)}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-100">
            {item?.zh ?? '（题目已不在当前题库中）'}
          </p>
          {row.lastText ? (
            <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
              我的译文：{row.lastText}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {item ? (
            <Button size="sm" variant="ghost" onClick={(): void => setOpen(!open)}>
              {open ? '收起' : '对照'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={(): void => {
              void markTranslationResolved(row.itemId, !row.resolved, instance).then(onChanged);
            }}
          >
            {row.resolved ? '取回' : '已掌握'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(): void => {
              void removeTranslationBookRow(row.itemId, instance).then(onChanged);
            }}
          >
            移出
          </Button>
        </div>
      </div>

      {open && item ? (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{item.reference}</p>
        </div>
      ) : null}
    </li>
  );
}