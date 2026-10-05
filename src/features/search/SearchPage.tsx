import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDb } from '@/app/providers/DbProvider';
import { searchByHeadword } from '@/data/repos/wordRepo';
import { findVocab, addVocab, removeVocab } from '@/data/repos/vocabRepo';
import { tierLabel } from '@/domain/word/tier';
import type { Word } from '@/domain/word/types';
import { Badge, Card, CardBody } from '@/ui/primitives';
import { StarButton } from '@/ui/word';

/**
 * 查词页 —— 一个背单词应用最基础的能力之一。
 *
 * ★ 此前 `wordRepo.searchByHeadword`（带 headword 索引）已经实现好，
 *   但**没有任何入口能调用它**：用户遇到生词只能从头背，查不到。
 *   搜索走本机 IndexedDB，不发网络请求，断网可用。
 */

const DEBOUNCE_MS = 150;

export default function SearchPage(): ReactNode {
  const instance = useDb();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Word[]>([]);
  const [searched, setSearched] = useState(false);
  const [starred, setStarred] = useState<Set<string>>(new Set());
  /**
   * 用户**手动**改过的词（区别于「搜索结果落地时批量标出的」）。
   *
   * ★ 为什么需要它：`findVocab` 是逐行 await 的，用户可能在标记还没落完时就点了星标。
   *   若直接 `setStarred(marks)` 覆盖，刚点的收藏会被搜索结果冲掉 —— 点了没反应。
   *   这里让「用户手动改过」优先于「批量标记」。每次新搜索开始时清空。
   */
  const dirtyRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const key = query.trim();
    if (!key) {
      setResults([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
    dirtyRef.current = new Set();
    const timer = setTimeout((): void => {
      void (async (): Promise<void> => {
        const rows = await searchByHeadword(key, 30, instance);
        if (cancelled) return;
        setResults(rows);
        setSearched(true);
        // 标出哪些已在生词本（避免用户反复加入）
        const marks = new Set<string>();
        for (const row of rows) {
          if (await findVocab(row.id, instance)) marks.add(row.id);
        }
        if (cancelled) return;
        setStarred((prev) => {
          const next = new Set(marks);
          for (const id of dirtyRef.current) {
            if (prev.has(id)) next.add(id);
            else next.delete(id);
          }
          return next;
        });
      })();
    }, DEBOUNCE_MS);

    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, instance]);

  const hint = useMemo(() => {
    if (!searched) return '输入单词查询，例如 ab';
    return results.length === 0 ? '没有匹配的词 —— 试试更短的前缀' : `找到 ${results.length} 个词`;
  }, [searched, results.length]);

  /**
   * 收藏 / 取消收藏。
   * ★ 修掉了原来的单向 bug：旧实现 `if (starred.has(word.id)) return;`
   *   —— 已收藏的词点不动，用户永远取消不了，只能干瞪眼。
   */
  const toggleStar = (word: Word): void => {
    void (async (): Promise<void> => {
      const has = starred.has(word.id);
      dirtyRef.current.add(word.id);
      if (has) await removeVocab(word.id, instance);
      else await addVocab({ wordId: word.id }, instance);
      setStarred((prev) => {
        const next = new Set(prev);
        if (has) next.delete(word.id);
        else next.add(word.id);
        return next;
      });
    })();
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">查词</h1>

      <input
        autoFocus
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
        placeholder="输入单词…"
        aria-label="搜索单词"
        className={[
          'h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-base',
          'text-slate-900 placeholder:text-slate-400',
          'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
          'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50',
        ].join(' ')}
      />

      <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>

      {results.length > 0 ? (
        <Card>
          <CardBody className="p-0">
            <ul>
              {results.map((word) => (
                <li
                  key={word.id}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={(): void => { void navigate(`/word/${encodeURIComponent(word.id)}`); }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                        {word.headword}
                      </span>
                      <Badge tone="neutral">{tierLabel(word.tier)}</Badge>
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        #{word.freqRank}
                      </span>
                    </div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {word.senses.slice(0, 3).map((s) => s.zh).join('；')}
                    </div>
                  </button>
                  <StarButton
                    starred={starred.has(word.id)}
                    onToggle={(): void => toggleStar(word)}
                    label={word.headword}
                    variant="plain"
                  />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
