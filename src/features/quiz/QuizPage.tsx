import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDb } from '@/app/providers/DbProvider';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useTts } from '@/hooks/useTts';
import {
  generateQuiz,
  type OptionKey,
  type QuizDirection,
  type QuizQuestion,
} from '@/domain/quiz/generator';
import {
  gradeQuiz,
  finishQuizSession,
  recycleQuizWrong,
  startQuizSession,
  type QuizAnswer,
} from '@/services/quizSession';
import { loadQuizPool, type QuizPoolSource } from '@/services/quizPool';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Progress, Segmented } from '@/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * 四选一测验页 —— 主动回忆（比"再背一遍"更能巩固记忆）。
 *
 * ★ 出题逻辑全部复用 `generateQuiz`（纯函数、已单测），本页只负责流程编排，
 *   绝不在这里重新实现"挑干扰项"之类的逻辑（两处实现必然漂移）。
 */

type Phase = 'setup' | 'running' | 'result';

const SOURCE_LABELS: Record<QuizPoolSource, string> = {
  learned: '已学词',
  due: '今日到期',
  wrong: '错题本',
  vocab: '生词本',
  rank: '按词频',
};

export default function QuizPage(): ReactNode {
  const instance = useDb();
  const navigate = useNavigate();
  const tts = useTts();
  const tier = useSettingsStore((s) => s.settings.tier);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);

  const [phase, setPhase] = useState<Phase>('setup');
  const [source, setSource] = useState<QuizPoolSource>('learned');
  const [direction, setDirection] = useState<QuizDirection>('en-to-zh');
  const [count, setCount] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, OptionKey>>({});
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [recycled, setRecycled] = useState<{ added: number; updated: number } | null>(null);

  useEffect(() => {
    void hydrateSettings();
  }, [hydrateSettings]);

  const start = useCallback((): void => {
    void (async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const seed = Date.now() % 2_147_483_647;
        const pool = await loadQuizPool({ source, tier, count, seed, instance });
        // ★ 多取一些被考词：生成器会因"干扰项不足"跳词，只给 count 个会导致题目变少
        const qs = generateQuiz({
          words: pool.targets,
          distractorPool: pool.distractors,
          count,
          direction,
          seed,
        });
        if (qs.length === 0) {
          setError(
            pool.targets.length === 0
              ? '这个词池里还没有词 —— 先去背词页学一组，或换个来源。'
              : '可用题目不足（需要足够的同档位词做干扰项），换个来源或降低题数再试。',
          );
          return;
        }
        const id = await startQuizSession('choice', instance);
        setQuestions(qs);
        setSessionId(id);
        setAnswers({});
        setIndex(0);
        setRecycled(null);
        setPhase('running');
      } catch (e) {
        setError(e instanceof Error ? e.message : '出题失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [source, tier, count, direction, instance]);

  // gradeQuiz 的入参以 QuizAnswer 为值（便于将来携带耗时等字段），页面侧只存选项键
  const answerMap = useMemo<Record<string, QuizAnswer>>(() => {
    const out: Record<string, QuizAnswer> = {};
    for (const [questionId, selectedKey] of Object.entries(answers)) {
      out[questionId] = { questionId, selectedKey };
    }
    return out;
  }, [answers]);

  const submit = useCallback((): void => {
    void (async (): Promise<void> => {
      const result = gradeQuiz(questions, answerMap);
      if (sessionId !== null) {
        await finishQuizSession(sessionId, { correct: result.correct, total: result.total }, instance);
      }
      const report = await recycleQuizWrong(result.wrongWordIds, instance);
      setRecycled(report);
      setPhase('result');
    })();
  }, [questions, answerMap, sessionId, instance]);

  const current = questions[index];
  const picked = current ? answers[current.id] : undefined;

  const handlePick = useCallback(
    (key: OptionKey): void => {
      if (!current || picked !== undefined) return;
      setAnswers((prev) => ({ ...prev, [current.id]: key }));
    },
    [current, picked],
  );

  useKeyboard({
    enabled: phase === 'running',
    onKey: (key): void => {
      if (!current) return;
      if (key === ' ' || key === 'enter') {
        if (picked !== undefined) {
          if (index + 1 < questions.length) setIndex(index + 1);
          else submit();
        }
        return;
      }
      const order: Record<string, OptionKey> = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
      const mapped = order[key] ?? (['a', 'b', 'c', 'd'].includes(key) ? (key.toUpperCase() as OptionKey) : undefined);
      if (mapped) handlePick(mapped);
    },
    onBack: (): void => { void navigate('/'); },
  });

  const graded = useMemo(() => (phase === 'result' ? gradeQuiz(questions, answerMap) : null), [
    phase,
    questions,
    answerMap,
  ]);

  // —— 配置态 ——
  if (phase === 'setup') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">四选一测验</h1>

        <Card>
          <CardHeader>
            <CardTitle>考哪些词</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Segmented
              ariaLabel="词池来源"
              block
              size="sm"
              options={(Object.keys(SOURCE_LABELS) as QuizPoolSource[]).map((s) => ({
                value: s,
                label: SOURCE_LABELS[s],
              }))}
              value={source}
              onChange={setSource}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {source === 'wrong'
                ? '只考你答错过/没答的词 —— 最省时间的提分项。'
                : source === 'vocab'
                  ? '考你主动收藏的生词。'
                  : source === 'due'
                    ? '考今天正好到期的词，等于提前自测复习。'
                    : source === 'rank'
                      ? '按词频档位取词，还没学过也能测。'
                      : '考所有已学过的词，查漏补缺。'}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>题型</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">方向</div>
              <Segmented
                ariaLabel="出题方向"
                block
                options={[
                  { value: 'en-to-zh', label: '看英选中文' },
                  { value: 'zh-to-en', label: '看中选英文' },
                ]}
                value={direction}
                onChange={(v): void => setDirection(v as QuizDirection)}
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">题数</div>
              <Segmented
                ariaLabel="题数"
                block
                options={[
                  { value: '10', label: '10' },
                  { value: '20', label: '20' },
                  { value: '30', label: '30' },
                ]}
                value={String(count)}
                onChange={(v): void => setCount(Number(v))}
              />
            </div>
          </CardBody>
        </Card>

        {error ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <Button block size="lg" loading={loading} onClick={start}>
          开始测验
        </Button>
      </div>
    );
  }

  // —— 结果态 ——
  if (phase === 'result' && graded) {
    const pct = graded.total === 0 ? 0 : graded.correct / graded.total;
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
        <Card>
          <CardHeader>
            <CardTitle>测验完成</CardTitle>
            <Badge tone={pct >= 0.8 ? 'success' : pct >= 0.5 ? 'warning' : 'danger'}>
              正确率 {Math.round(pct * 100)}%
            </Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <Progress value={pct} label={`${graded.correct} / ${graded.total} 题`} />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              答错与未答的词已进错题本
              {recycled ? `（新增 ${recycled.added} · 累加 ${recycled.updated}）` : ''}
              ，会在复习里再次出现。
            </p>
            <div className="flex gap-2">
              <Button block variant="secondary" onClick={(): void => { void navigate('/wrong'); }}>
                看错题本
              </Button>
              <Button block onClick={(): void => setPhase('setup')}>
                再来一组
              </Button>
            </div>
            <Button block variant="ghost" onClick={(): void => { void navigate('/'); }}>
              返回首页
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>逐题回顾</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {questions.map((q, i) => {
              const selected = answers[q.id];
              const ok = selected === q.answerKey;
              return (
                <div
                  key={q.id}
                  className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                      {i + 1}. {q.stem}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      正确答案 {q.answerKey} ·{' '}
                      {q.options.find((o) => o.key === q.answerKey)?.text}
                    </span>
                  </span>
                  <Badge tone={ok ? 'success' : selected === undefined ? 'neutral' : 'danger'}>
                    {ok ? '对' : selected === undefined ? '未答' : '错'}
                  </Badge>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>
    );
  }

  // —— 答题态 ——
  if (!current) {
    return <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">加载中…</div>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-50">
          第 {index + 1} / {questions.length} 题
        </h1>
        <Button size="sm" variant="ghost" onClick={(): void => { void navigate('/'); }}>
          退出
        </Button>
      </div>
      <Progress value={index / questions.length} label="测验进度" />

      <Card>
        <CardHeader>
          <CardTitle>{current.stem}</CardTitle>
          {direction === 'en-to-zh' ? (
            <button
              type="button"
              aria-label="朗读"
              className="text-xs text-brand-600 dark:text-brand-400"
              onClick={(): void => tts.speak(current.stem)}
            >
              🔊
            </button>
          ) : null}
        </CardHeader>
        <CardBody className="space-y-2">
          {current.options.map((opt) => {
            const isPicked = picked === opt.key;
            const isAnswer = opt.key === current.answerKey;
            // 未作答：中性；作答后：正确答案恒高亮为"对"，错选高亮为"错"
            const tone =
              picked === undefined
                ? ''
                : isAnswer
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950'
                  : isPicked
                    ? 'border-red-500 bg-red-50 dark:bg-red-950'
                    : 'opacity-60';
            return (
              <button
                key={opt.key}
                type="button"
                disabled={picked !== undefined}
                onClick={(): void => handlePick(opt.key)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                  'border-slate-200 dark:border-slate-700',
                  picked === undefined && 'hover:bg-slate-50 dark:hover:bg-slate-800',
                  tone,
                )}
              >
                <span className="w-5 shrink-0 text-sm font-semibold text-slate-500 dark:text-slate-400">
                  {opt.key}
                </span>
                <span className="text-sm text-slate-900 dark:text-slate-50">{opt.text}</span>
              </button>
            );
          })}
        </CardBody>
      </Card>

      {picked !== undefined ? (
        <div className="space-y-2">
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-sm',
              picked === current.answerKey
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
            )}
          >
            {picked === current.answerKey ? '答对了' : `答错了 —— 正确答案是 ${current.answerKey}`}
          </div>
          <Button
            block
            size="lg"
            onClick={(): void => {
              if (index + 1 < questions.length) setIndex(index + 1);
              else submit();
            }}
          >
            {index + 1 < questions.length ? '下一题（Space）' : '交卷看结果'}
          </Button>
        </div>
      ) : (
        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          键盘可选：1-4 或 A-D
        </p>
      )}
    </div>
  );
}
