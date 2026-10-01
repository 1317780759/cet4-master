import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDb } from '@/app/providers/DbProvider';
import { searchByHeadword } from '@/data/repos/wordRepo';
import { findVocab, addVocab } from '@/data/repos/vocabRepo';
import { tierLabel } from '@/domain/word/tier';
import type { Word } from '@/domain/word/types';
import { Badge, Card, CardBody } from '@/ui/primitives';

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

  useEffect(() => {
    const key = query.trim();
    if (!key) {
      setResults([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
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
        if (!cancelled) setStarred(marks);
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

  const toggleStar = (word: Word): void => {
    void (async (): Promise<void> => {
      if (starred.has(word.id)) return; // 幂等：已在生词本就不再重复加
      await addVocab({ wordId: word.id }, instance);
      setStarred((prev) => new Set(prev).add(word.id));
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
                  <button
                    type="button"
                    aria-label={starred.has(word.id) ? `${word.headword} 已在生词本` : `把 ${word.headword} 加入生词本`}
                    onClick={(): void => toggleStar(word)}
                    className="shrink-0 px-2 text-lg leading-none"
                  >
                    {starred.has(word.id) ? '★' : '☆'}
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
