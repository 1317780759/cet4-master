import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDb } from '@/app/providers/DbProvider';
import { hintLevels } from '@/domain/translation/hints';
import { translationTopicLabel } from '@/domain/translation/topics';
import { TRANSLATION_TOPIC_KEYS, TRANSLATION_TOPIC_LABEL } from '@/domain/translation/topics';
import type { ScoreResult, TranslationItem, TranslationTopicKey } from '@/domain/translation/types';
import {
  DEFAULT_TRANSLATION_COUNT,
  isTooShort,
  startTranslation,
  submitTranslation,
  toLlmRequest,
  type TranslationMode,
} from '@/services/translationSession';
import {
  getLlmScorer,
  getOfflineScorer,
  isAiConfigComplete,
  isSecureBaseUrl,
} from '@/services/translationScorerRegistry';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Progress, Segmented } from '@/ui/primitives';
import { DualScoreCard, type AiCardState } from './components/DualScoreCard';
import { useTranslationBank } from './useTranslationBank';
import { cn } from '@/lib/cn';

/**
 * 翻译训练作答页 —— 中译英单句训练。
 *
 * ★ 三条不可动摇的产品约束（docs/04b §5.13 铁律）：
 *   1. **离线评分是默认且永不失效的路径**：先算离线分、立即展示、写库，
 *      之后才去问 AI 要不要补充批改。任何 AI 失败都只是少一张卡，绝不影响前面三步。
 *   2. **不猜题意**：只有「看参考译文」这一个显式动作会揭示 reference，
 *      揭示与否如实记录，绝不因为"用户答得差"就自动剧透。
 *   3. **AI 只是增强**：AI 卡缺席时，离线卡的分数、逐条命中、档位、错句本落库全部照常。
 */

type Phase = 'setup' | 'loading' | 'running' | 'finished';

/**
 * 本轮句数候选。
 *
 * ★ 显式声明成 `string` 而不是 `as const` 元组：`Segmented<T>` 是泛型，
 *   `T` 由 `value: string` 反推；用字面量元组会让 `String(count)` 的结果
 *   塞不进 `T = '5' | '10' | ...`，反而在 URL 里的任意合法值上编译不过。
 */
const COUNT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = ['5', '10', '15', '20'].map(
  (n) => ({ value: n, label: `${n} 句` }),
);

/** 当前句数是否落在候选内；不在（URL 被手改成 7）则回落到 10 */
function countOptionValue(count: number): string {
  return COUNT_OPTIONS.some((o) => o.value === String(count)) ? String(count) : '10';
}

const MODE_OPTIONS: ReadonlyArray<{ value: TranslationMode; label: string }> = [
  { value: 'random', label: '随机混合' },
  { value: 'topic', label: '指定话题' },
  { value: 'review', label: '错句重做' },
];

const DIFFICULTY_LABEL: Record<1 | 2 | 3, string> = { 1: '较易', 2: '中等', 3: '较难' };

export default function TranslationPracticePage(): ReactNode {
  const instance = useDb();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const bank = useTranslationBank();
  const settings = useSettingsStore((s) => s.settings);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    void hydrateSettings();
  }, [hydrateSettings]);

  // ── 会话参数（走 URL，保证"刷新 / 分享链接"能复现同一轮练习）──
  const mode = (params.get('mode') as TranslationMode | null) ?? 'random';
  const topicParam = params.get('topic');
  const topic = (TRANSLATION_TOPIC_KEYS as readonly string[]).includes(topicParam ?? '')
    ? (topicParam as TranslationTopicKey)
    : null;
  const count = Math.min(30, Math.max(3, Number(params.get('count')) || DEFAULT_TRANSLATION_COUNT));

  const [phase, setPhase] = useState<Phase>('setup');
  const [items, setItems] = useState<TranslationItem[]>([]);
  const [index, setIndex] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const current = items[index];

  // ── 作答态 ──
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [offline, setOffline] = useState<ScoreResult | null>(null);
  const [ai, setAi] = useState<AiCardState>({ kind: 'off' });
  const [showReference, setShowReference] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
  const [bookNotice, setBookNotice] = useState<string | null>(null);

  //★ AI 批改在途时离开页面 → 中止请求，避免回退到结果页后还在写 state
  const aiAbort = useRef(false);
  useEffect(() => {
    return (): void => {
      aiAbort.current = true;
    };
  }, []);

  const setParam = useCallback(
    (patch: Record<string, string | null>): void => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  /** 清空作答态（切题时调用） */
  const resetAnswer = useCallback((): void => {
    setDraft('');
    setSubmitted(false);
    setOffline(null);
    setAi({ kind: 'off' });
    setShowReference(false);
    setHintLevel(0);
    setBookNotice(null);
    aiAbort.current = false;
  }, []);

  const load = useCallback((): void => {
    setLoadError(null);
    setPhase('loading');
    resetAnswer();
    void (async (): Promise<void> => {
      try {
        const list = await startTranslation({
          mode,
          topic: topic ?? undefined,
          count,
          instance,
        });
        if (list.length === 0) {
          setLoadError(
            mode === 'review' ? '错句本是空的 —— 先练几轮，答不准的句子会自动收进来。' : '没有取到句子，请稍后重试。',
          );
          setPhase('setup');
          return;
        }
        setItems(list);
        setIndex(0);
        setPhase('running');
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : '加载失败');
        setPhase('setup');
      }
    })();
  }, [mode, topic, count, instance, resetAnswer]);

  // ── 提交：离线评分先行，AI 随后（可缺席）──
  const handleSubmit = useCallback((): void => {
    if (!current || submitted) return;
    const text = draft.trim();
    if (isTooShort(text)) {
      setBookNotice('译文太短了 —— 先把这句话完整写出来再判分。');
      return;
    }
    setBookNotice(null);
    setSubmitted(true);

    void (async (): Promise<void> => {
      // ① 离线评分：纯函数、零网络，**必须先成功**
      const offlineScorer = getOfflineScorer();
      const result = await submitTranslation(current, text, offlineScorer, Date.now(), instance);
      setOffline(result.score);
      setBookNotice(
        result.added
          ? '命中率偏低，已收进错句本。'
          : result.inBook
            ? '已更新错句本里的这条记录。'
            : '命中率达标，没有进错句本。',
      );

      // ② AI 批改：可缺席。配置不全就直接不渲染 AI 卡。
      const llm = await getLlmScorer(settings, instance);
      if (!llm) return;
      if (aiAbort.current) return;
      setAi({ kind: 'pending', preview: '' });

      try {
        const reviewed = await llm.review(toLlmRequest(current, text), (chunk) => {
          setAi((prev) => (prev.kind === 'pending' ? { kind: 'pending', preview: prev.preview + chunk } : prev));
        });
        if (aiAbort.current) return;
        setAi({ kind: 'done', review: reviewed.review });
      } catch (e) {
        if (aiAbort.current) return;
        // ★ 失败只降级：给一行文案 + 离线评分照常呈现，无弹窗、无白屏
        const message = e instanceof Error && e.message ? e.message : '未知原因';
        setAi({ kind: 'failed', message });
      }
    })();
  }, [current, submitted, draft, settings, instance]);

  const handleNext = useCallback((): void => {
    resetAnswer();
    if (index + 1 < items.length) setIndex(index + 1);
    else setPhase('finished');
  }, [index, items.length, resetAnswer]);

  // ── 统计（用于进度条）──
  const doneCount = items.length;
  const progress = doneCount > 0 ? ((index + (submitted ? 1 : 0)) / doneCount) * 100 : 0;
  const aiReady = isAiConfigComplete(settings.aiConfig) && isSecureBaseUrl(settings.aiConfig.baseUrl);

  const hints = useMemo(() => (current ? hintLevels(current) : []), [current]);

  // ══════════════ 设置态 ══════════════
  if (phase === 'setup') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
        <Header onBack={() => navigate('/translation')} />

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

        {loadError ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {loadError}
          </div>
        ) : null}

        {bank.status === 'ready' ? (
          <Card>
            <CardHeader>
              <CardTitle>选题</CardTitle>
              <Badge tone="neutral">题库 {bank.count} 句</Badge>
            </CardHeader>
            <CardBody className="space-y-4">
              <Segmented
                ariaLabel="选题方式"
                block
                options={MODE_OPTIONS}
                value={mode}
                onChange={(v): void => setParam({ mode: v, topic: v === 'topic' ? (topic ?? TRANSLATION_TOPIC_KEYS[0]) : null })}
              />

              {mode === 'topic' ? (
                <div>
                  <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">话题</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {TRANSLATION_TOPIC_KEYS.map((key) => {
                      const active = topic === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={active}
                          onClick={(): void => setParam({ topic: key })}
                          className={cn(
                            'min-h-11 rounded-md border px-3 py-2 text-sm transition-colors touch-manipulation',
                            'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                            active
                              ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-slate-800 dark:text-brand-200'
                              : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                          )}
                        >
                          {TRANSLATION_TOPIC_LABEL[key]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">本轮句数</div>
                <Segmented
                  ariaLabel="本轮句数"
                  block
                  options={COUNT_OPTIONS}
                  value={countOptionValue(count)}
                  onChange={(v): void => setParam({ count: v })}
                />
              </div>

              {!aiReady ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  AI 批改未开启 —— 本轮会用离线关键词评分，功能完整可用。
                </p>
              ) : null}

              <Button block size="lg" onClick={load}>
                开始
              </Button>
            </CardBody>
          </Card>
        ) : null}
      </div>
    );
  }

  // ══════════════ 结果态 ══════════════
  if (phase === 'finished') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
        <Header onBack={() => navigate('/translation')} />
        <Card>
          <CardHeader>
            <CardTitle>这一轮练完了</CardTitle>
            <Badge tone="info">{items.length} 句</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              命中率不到 80% 的句子已自动进入错句本，下次可以用「错句重做」再打一遍。
            </p>
            <div className="flex gap-2">
              <Button block onClick={load}>
                再来一轮
              </Button>
              <Button block variant="secondary" onClick={(): void => void navigate('/translation/book')}>
                错句本
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // ══════════════ 作答态 ══════════════
  if (phase === 'loading' || !current) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-sm text-slate-400 dark:text-slate-500">
        正在选题…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
      <Header onBack={() => navigate('/translation')} />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone="info">
            {index + 1} / {items.length}
          </Badge>
          <Badge tone="neutral">{translationTopicLabel(current.topic)}</Badge>
          <Badge tone="neutral">{DIFFICULTY_LABEL[current.difficulty]}</Badge>
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {mode === 'random' ? '随机混合' : mode === 'review' ? '错句重做' : '话题练习'}
        </span>
      </div>
      <Progress value={progress} label="本轮进度" />

      <Card>
        <CardHeader>
          <CardTitle>把这句话译成英文</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="font-display text-lg leading-relaxed text-slate-900 dark:text-slate-50">
            {current.zh}
          </p>

          {hintLevel > 0 ? (
            <ul className="space-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
              {hints.slice(0, hintLevel).map((hint, i) => (
                <li key={hint} className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="mr-1 text-slate-400">提示 {i + 1}</span>
                  {hint}
                </li>
              ))}
            </ul>
          ) : null}

          <textarea
            value={draft}
            onChange={(e): void => setDraft(e.target.value)}
            disabled={submitted}
            rows={4}
            placeholder="在这里写下你的英文译文…"
            aria-label="英文译文"
            className="w-full resize-y rounded-md border border-slate-300 bg-surface px-3 py-2 text-base text-slate-900 touch-manipulation placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />

          {!submitted ? (
            <div className="flex gap-2">
              {hints.length > hintLevel ? (
                <Button
                  variant="secondary"
                  onClick={(): void => setHintLevel(hintLevel + 1)}
                >
                  {hintLevel === 0 ? '给点提示' : '再给一点'}
                </Button>
              ) : null}
              <Button block onClick={handleSubmit} disabled={draft.trim().length === 0}>
                提交批改
              </Button>
            </div>
          ) : null}

          {bookNotice ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
              {bookNotice}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {submitted && offline ? (
        <>
          <DualScoreCard offline={offline} ai={ai} />

          <Card>
            <CardHeader>
              <CardTitle>参考答案</CardTitle>
              <Button size="sm" variant="ghost" onClick={(): void => setShowReference(!showReference)}>
                {showReference ? '收起' : '看参考译文'}
              </Button>
            </CardHeader>
            <CardBody className="space-y-2">
              {showReference ? (
                <>
                  <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                    {current.reference}
                  </p>
                  {current.topicWords && current.topicWords.length > 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      话题词：{current.topicWords.join('、')}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  先自己改一遍再看参考答案 —— 直接对照的效果很有限。
                </p>
              )}
            </CardBody>
          </Card>

          <div className="flex gap-2">
            <Button block variant="secondary" onClick={(): void => void navigate('/translation')}>
              结束本轮
            </Button>
            <Button block onClick={handleNext}>
              {index + 1 < items.length ? '下一句' : '完成'}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="font-display text-xl text-slate-900 dark:text-slate-50">翻译训练</h1>
      <Button size="sm" variant="ghost" onClick={onBack}>
        返回选题
      </Button>
    </div>
  );
}