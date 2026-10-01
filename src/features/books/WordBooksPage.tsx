import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDb } from '@/app/providers/DbProvider';
import { getWords } from '@/data/repos/wordRepo';
import { ensureCard } from '@/data/repos/cardRepo';
import { listVocab, promoteVocab, removeVocab } from '@/data/repos/vocabRepo';
import { listWrong } from '@/data/repos/wrongRepo';
import { reopenWrong, resolveWrong } from '@/services/wrongBookService';
import type { VocabBookRow, WrongBookRow } from '@/data/db/rows';
import type { Word } from '@/domain/word/types';
import { formatRelative } from '@/lib/date';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Segmented } from '@/ui/primitives';

/**
 * 生词本 / 错词本 —— 记忆闭环的两端。
 *
 * ★ 为什么必须做这两页：
 *   生词本 = 主动收藏，错词本 = 被动记录（答错自动进，且带 FSRS 重现间隔）。
 *   此前两者都只有落库逻辑、没有任何界面 —— 用户错过的词**永远不会被再练到**，
 *   「背词 → 自测 → 错题重现」这条最能提分的链路是断的。
 */

type BookTab = 'vocab' | 'wrong';

export default function WordBooksPage(): ReactNode {
  const [tab, setTab] = useState<BookTab>('wrong');
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">我的词本</h1>
      <Segmented
        ariaLabel="词本"
        block
        options={[
          { value: 'wrong', label: '错词本' },
          { value: 'vocab', label: '生词本' },
        ]}
        value={tab}
        onChange={(v): void => setTab(v as BookTab)}
      />
      {tab === 'wrong' ? <WrongBook /> : <VocabBook />}
    </div>
  );
}

/** 取一批词并建 id → Word 映射（查不到的词不渲染，避免白屏） */
async function loadWords(ids: readonly string[], instance: Parameters<typeof getWords>[1]): Promise<Map<string, Word>> {
  const words = await getWords(ids, instance);
  return new Map(words.map((w) => [w.id, w]));
}

function senseText(word: Word | undefined): string {
  if (!word) return '';
  return word.senses
    .slice(0, 3)
    .map((s) => s.zh)
    .join('；');
}

// ————————————————— 错词本 —————————————————

function WrongBook(): ReactNode {
  const instance = useDb();
  const navigate = useNavigate();
  const [rows, setRows] = useState<WrongBookRow[]>([]);
  const [words, setWords] = useState<Map<string, Word>>(new Map());
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<number>(() => Date.now());

  const reload = useCallback((): void => {
    void (async (): Promise<void> => {
      setLoading(true);
      const list = await listWrong({ limit: 500 }, instance);
      setRows(list);
      setWords(await loadWords(list.map((r) => r.wordId).filter((id): id is string => !!id), instance));
      setNow(Date.now());
      setLoading(false);
    })();
  }, [instance]);

  useEffect(reload, [reload]);

  const dueCount = rows.filter((r) => r.nextDue <= now).length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>概览</CardTitle>
          <Badge tone={dueCount > 0 ? 'warning' : 'neutral'}>
            {dueCount > 0 ? `${dueCount} 个待重做` : '暂无到期'}
          </Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            答错与未答的词会自动进这里，并按间隔重新出现。连续练对后可以归档。
          </p>
          <Button
            block
            disabled={rows.length === 0}
            onClick={(): void => { void navigate('/quiz'); }}
          >
            去测验这些词
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>错词（{rows.length}）</CardTitle>
          <span className="text-xs text-slate-400 dark:text-slate-500">按错误次数排序</span>
        </CardHeader>
        <CardBody>
          {loading ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">加载中…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              还没有错词 —— 保持住，或者去测验页自测一下。
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => {
                const word = row.wordId ? words.get(row.wordId) : undefined;
                const title = word?.headword ?? row.questionId ?? row.paperId ?? '（已无对应词）';
                return (
                  <li
                    key={row.id ?? `${row.source}-${row.wordId ?? row.questionId ?? ''}`}
                    className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="truncate text-sm font-medium text-slate-900 underline-offset-2 hover:underline dark:text-slate-50"
                          onClick={(): void => {
                            if (word) void navigate(`/word/${encodeURIComponent(word.id)}`);
                          }}
                        >
                          {title}
                        </button>
                        <Badge tone="danger">错 {row.wrongCount} 次</Badge>
                        {row.nextDue <= now ? <Badge tone="warning">待重做</Badge> : null}
                      </div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {senseText(word) || `来源：${row.source}`}
                        {' · '}
                        {formatRelative(row.lastWrongAt, now)}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(): void => {
                          if (row.id === undefined) return;
                          void reopenWrong(row.id, Date.now(), instance).then(reload);
                        }}
                      >
                        重练
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(): void => {
                          if (row.id === undefined) return;
                          void resolveWrong(row.id, instance).then(reload);
                        }}
                      >
                        归档
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}

// ————————————————— 生词本 —————————————————

function VocabBook(): ReactNode {
  const instance = useDb();
  const navigate = useNavigate();
  const [rows, setRows] = useState<VocabBookRow[]>([]);
  const [words, setWords] = useState<Map<string, Word>>(new Map());
  const [loading, setLoading] = useState(true);

  const reload = useCallback((): void => {
    void (async (): Promise<void> => {
      setLoading(true);
      const list = await listVocab(500, instance);
      setRows(list);
      setWords(await loadWords(list.map((r) => r.wordId), instance));
      setLoading(false);
    })();
  }, [instance]);

  useEffect(reload, [reload]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>生词（{rows.length}）</CardTitle>
        <span className="text-xs text-slate-400 dark:text-slate-500">主动收藏</span>
      </CardHeader>
      <CardBody>
        {loading ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            还没有收藏的生词 —— 在单词详情页可以一键加入。
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const word = words.get(row.wordId);
              return (
                <li
                  key={row.id ?? row.wordId}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="truncate text-sm font-medium text-slate-900 underline-offset-2 hover:underline dark:text-slate-50"
                      onClick={(): void => {
                        if (word) void navigate(`/word/${encodeURIComponent(word.id)}`);
                      }}
                    >
                      {word?.headword ?? row.wordId}
                    </button>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {senseText(word)}
                      {row.promoted ? ' · 已在队列' : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!row.promoted && word ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(): void => {
                          void (async (): Promise<void> => {
                            // ★ 光标记 promoted 不够：必须真的建卡，它才会进入 FSRS 队列被排到
                            await ensureCard(row.wordId, word.freqRank, Date.now(), instance);
                            await promoteVocab(row.wordId, instance);
                            reload();
                          })();
                        }}
                      >
                        加入队列
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(): void => {
                        void removeVocab(row.wordId, instance).then(reload);
                      }}
                    >
                      移出
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
