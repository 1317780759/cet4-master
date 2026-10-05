import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSentencesForWord } from '@/data/repos/sentenceRepo';
import type { ExamSentence } from '@/domain/exam/types';
import { formatInterval, preview } from '@/domain/fsrs/scheduler';
import { formatCountdown } from '@/lib/date';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useTts } from '@/hooks/useTts';
import { useVocabToggle } from '@/hooks/useVocabToggle';
import { useSettingsStore } from '@/store/useSettingsStore';
import { selectCurrent, selectProgress, useStudyStore } from '@/store/useStudyStore';
import type { SessionMode } from '@/services/studySession';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Progress } from '@/ui/primitives';
import { RatingBar, WordCard, type SelfRating } from '@/ui/word';

export interface StudyRunnerProps {
  mode: SessionMode;
  title: string;
  /** 队列为空时的文案 */
  emptyTitle: string;
  emptyHint: ReactNode;
  exitTo?: string;
}

/**
 * 背词会话运行器 —— LearnPage 与 ReviewPage 共用的页面骨架。
 * 唯一允许组装「service + store + ui」的地方（features 层）。
 */
export function StudyRunner({
  mode,
  title,
  emptyTitle,
  emptyHint,
  exitTo = '/',
}: StudyRunnerProps): ReactNode {
  const navigate = useNavigate();
  const phase = useStudyStore((s) => s.phase);
  const item = useStudyStore(selectCurrent);
  const progress = useStudyStore(selectProgress);
  const revealed = useStudyStore((s) => s.revealed);
  const rated = useStudyStore((s) => s.rated);
  const queueLength = useStudyStore((s) => s.queue.length);
  const newCount = useStudyStore((s) => s.newCount);
  const reviewCount = useStudyStore((s) => s.reviewCount);
  const summary = useStudyStore((s) => s.summary);
  const error = useStudyStore((s) => s.error);
  const pendingCount = useStudyStore((s) => s.pendingCount);
  const pendingDueAt = useStudyStore((s) => s.pendingDueAt);
  const start = useStudyStore((s) => s.start);
  const reveal = useStudyStore((s) => s.reveal);
  const rate = useStudyStore((s) => s.rate);
  const resume = useStudyStore((s) => s.resume);
  const finish = useStudyStore((s) => s.finish);
  const reset = useStudyStore((s) => s.reset);

  const autoPlay = useSettingsStore((s) => s.settings.autoPlay);
  const accent = useSettingsStore((s) => s.settings.accent);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const tts = useTts();

  // 收藏（生词本）—— 与查词页 / 详情页共用同一套语义，可收藏也可取消
  const vocab = useVocabToggle(item?.word.id);

  const [sentences, setSentences] = useState<ExamSentence[]>([]);
  const spokenRef = useRef<string | null>(null);

  // 进入页面即「先补全设置，再开一组」（保证 dailyGoal / tier / peekPenalty 生效）
  useEffect(() => {
    void (async (): Promise<void> => {
      await hydrateSettings();
      await start(mode);
    })();
    return (): void => reset();
  }, [mode, start, reset, hydrateSettings]);

  // 切词时加载真题例句（无语料时为空数组 → UI 降级）
  const wordId = item?.word.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!wordId) {
      setSentences([]);
      return;
    }
    void (async (): Promise<void> => {
      const rows = await listSentencesForWord(wordId);
      if (!cancelled) setSentences(rows);
    })();
    return (): void => {
      cancelled = true;
    };
  }, [wordId]);

  // 自动发音（受浏览器手势解锁限制；未解锁时静默失败）
  useEffect(() => {
    if (!autoPlay || !tts.enabled || !item) return;
    if (spokenRef.current === item.word.id) return;
    spokenRef.current = item.word.id;
    tts.speak(item.word.headword);
  }, [autoPlay, tts, item]);

  const hints = useMemo(() => {
    if (!item) return undefined;
    const now = Date.now();
    const p = preview(item.card, now);
    return {
      unknown: formatInterval(now, p[1].card.due),
      fuzzy: formatInterval(now, p[2].card.due),
      known: formatInterval(now, p[3].card.due),
    };
  }, [item]);

  const handleRate = useCallback(
    (self: SelfRating): void => {
      void rate(self);
    },
    [rate],
  );

  /** 翻卡按钮：只负责翻卡，不兼职发音（手机端要的是两个独立的按钮） */
  const handleReveal = useCallback((): void => {
    if (!revealed) reveal();
  }, [revealed, reveal]);

  /** 重听按钮：翻卡前后都在，按当前设置口音重复朗读 */
  const handleReplay = useCallback((): void => {
    if (!item) return;
    tts.speak(item.word.headword);
  }, [item, tts]);

  /** 空格键：未翻卡则翻卡，已翻卡则重听（保留桌面端原有手感） */
  const handleSpace = useCallback((): void => {
    if (!item) return;
    if (!revealed) reveal();
    else tts.speak(item.word.headword);
  }, [item, revealed, reveal, tts]);

  useKeyboard({
    onReveal: handleSpace,
    onKnown: (): void => handleRate('known'),
    onFuzzy: (): void => handleRate('fuzzy'),
    onUnknown: (): void => handleRate('unknown'),
    onBack: (): void => { void navigate(exitTo); },
    enabled: phase === 'studying',
  });

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        正在准备学习队列…
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>出错了</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p>{error ?? '未知错误'}</p>
            <Button onClick={(): void => void start(mode)}>重试</Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <WaitingPanel
        pendingCount={pendingCount}
        pendingDueAt={pendingDueAt}
        resume={resume}
        finish={finish}
      />
    );
  }

  if (phase === 'empty') {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>{emptyTitle}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p>{emptyHint}</p>
            <Button onClick={(): void => { void navigate(exitTo); }}>返回首页</Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (phase === 'finished') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>本组完成</CardTitle>
            <Badge tone="success">连续 {summary?.streak ?? 0} 天</Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            <SummaryRow label="本组评级次数" value={`${rated} 次`} />
            <SummaryRow label="今日新学" value={`${summary?.newLearned ?? 0} 个`} />
            <SummaryRow label="今日复习" value={`${summary?.reviewed ?? 0} 张`} />
            <SummaryRow label="今日正确" value={`${summary?.correct ?? 0} 次`} />
            <SummaryRow label="今日答错" value={`${summary?.wrong ?? 0} 次`} />
          </CardBody>
        </Card>
        <div className="flex gap-2">
          <Button block variant="secondary" onClick={(): void => void start(mode)}>
            再来一组
          </Button>
          <Button block onClick={(): void => { void navigate(exitTo); }}>
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  if (!item) {
    return <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">加载中…</div>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
          <Badge tone="info">已完成 {rated} / {queueLength}</Badge>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            新词 {newCount} · 复习 {reviewCount}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={(): void => { void navigate(exitTo); }}>
          退出
        </Button>
      </div>

      <Progress value={progress} label="本组进度" />

      <WordCard
        word={item.word}
        revealed={revealed}
        isNew={item.isNew}
        accent={accent}
        sentences={sentences}
        starred={vocab.starred}
        onToggleStar={(): void => { void vocab.toggle(); }}
        onPlay={(which): void => { tts.speak(item.word.headword, which); }}
        onWordClick={(id): void => { void navigate(`/word/${encodeURIComponent(id)}`); }}
      />

      {revealed ? (
        <div className="space-y-2">
          <RatingBar visible hints={hints} onRate={handleRate} />
          <Button block size="lg" variant="secondary" onClick={handleReplay}>
            <SpeakerIcon />
            再听一次
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="lg"
            variant="secondary"
            onClick={handleReplay}
            aria-label="播放发音"
            className="shrink-0 px-4"
          >
            <SpeakerIcon />
          </Button>
          <Button block size="lg" onClick={handleReveal}>
            显示释义（Space）
          </Button>
        </div>
      )}
    </div>
  );
}

/** 内联喇叭图标（不引图标库） */
function SpeakerIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z" strokeLinejoin="round" />
      <path d="M15.5 9a4 4 0 0 1 0 6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * R-A1 等待面板：队列暂空但仍有临期卡时展示，倒计时到点自动续，也可「立即继续 / 结束本组」。
 * 绝不显示「本组完成」——那是 finish 相位的事。
 */
function WaitingPanel({
  pendingCount,
  pendingDueAt,
  resume,
  finish,
}: {
  pendingCount: number;
  pendingDueAt: number | null;
  resume: (force?: boolean) => Promise<void>;
  finish: () => Promise<void>;
}): ReactNode {
  const [now, setNow] = useState<number>(() => Date.now());
  const autoOnce = useRef(false);

  // 500ms 心跳驱动倒计时
  useEffect((): (() => void) => {
    const timer = setInterval((): void => setNow(Date.now()), 500);
    return (): void => clearInterval(timer);
  }, []);

  const remainMs = Math.max(0, (pendingDueAt ?? now) - now);
  const countdown = formatCountdown(remainMs);

  // 归零时自动续一次（ref 守卫，避免重复触发）
  useEffect((): void => {
    if (remainMs <= 0 && !autoOnce.current) {
      autoOnce.current = true;
      void resume(false);
    }
  }, [remainMs, resume]);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>稍等片刻</CardTitle>
          <Badge tone="info">{countdown}</Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          <p>
            还有 {pendingCount} 张将在约 {countdown}后到期
          </p>
          <div className="flex gap-2">
            <Button block variant="secondary" onClick={(): void => void resume(true)}>
              立即继续
            </Button>
            <Button block onClick={(): void => void finish()}>
              结束本组
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}
