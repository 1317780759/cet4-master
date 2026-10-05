import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCard } from '@/data/repos/cardRepo';
import { listSentencesForWord } from '@/data/repos/sentenceRepo';
import { addVocab, findVocab, removeVocab } from '@/data/repos/vocabRepo';
import { getWord } from '@/data/repos/wordRepo';
import type { ExamSentence } from '@/domain/exam/types';
import { formatInterval } from '@/domain/fsrs/scheduler';
import { FSRS_STATE_LABEL, type ReviewCard } from '@/domain/fsrs/types';
import type { Word } from '@/domain/word/types';
import { tierLabel } from '@/domain/word/tier';
import { useTts } from '@/hooks/useTts';
import { formatRelative } from '@/lib/date';
import { describeError } from '@/lib/result';
import { setCardSuspended } from '@/services/studySession';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Spinner } from '@/ui/primitives';
import { WordCard } from '@/ui/word';

/**
 * 单词详情页（深链 `/word/:id`）—— 差异化②「单词 ↔ 真题语境」的落点。
 * 展示释义、真题例句（高亮）、FSRS 记忆状态，并提供收藏 / 标记掌握。
 */
export default function WordDetailPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tts = useTts();

  const [word, setWord] = useState<Word | null>(null);
  const [sentences, setSentences] = useState<ExamSentence[]>([]);
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [inVocab, setInVocab] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async (): Promise<void> => {
      if (!id) return;
      try {
        const [found, rows, existingCard, vocab] = await Promise.all([
          getWord(id),
          listSentencesForWord(id),
          getCard(id),
          findVocab(id),
        ]);
        if (cancelled) return;
        setWord(found ?? null);
        setSentences(rows);
        setCard(existingCard ?? null);
        setInVocab(Boolean(vocab));
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [id]);

  const toggleVocab = useCallback(async (): Promise<void> => {
    if (!word) return;
    if (inVocab) {
      await removeVocab(word.id);
      setInVocab(false);
      return;
    }
    await addVocab({ wordId: word.id });
    setInVocab(true);
  }, [word, inVocab]);

  const toggleMastered = useCallback(async (): Promise<void> => {
    if (!word) return;
    const fallback: ReviewCard = {
      wordId: word.id,
      due: Date.now(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      suspended: false,
      createdAt: Date.now(),
      introsRank: word.freqRank,
      learningSteps: 0,
    };
    const base = card ?? fallback;
    const next = await setCardSuspended(base, !base.suspended);
    setCard(next);
  }, [word, card]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-2xl items-center justify-center py-16 text-slate-500 dark:text-slate-400">
        <Spinner className="mr-2" />
        <span className="text-sm">加载中…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardBody>{error}</CardBody>
        </Card>
      </div>
    );
  }

  if (!word) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>找不到这个词</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm">该词可能不属于当前词库档位，或链接已失效。</p>
            <Button onClick={(): void => { void navigate('/'); }}>返回首页</Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={(): void => { void navigate(-1); }}>
          ← 返回
        </Button>
        <Badge tone="neutral">{tierLabel(word.tier)}</Badge>
      </div>

      <WordCard
        word={word}
        revealed
        accent="us"
        sentences={sentences}
        starred={inVocab}
        onToggleStar={(): void => { void toggleVocab(); }}
        onPlay={(which): void => tts.speak(word.headword, which)}
        onWordClick={(targetId): void => { void navigate(`/word/${encodeURIComponent(targetId)}`); }}
      />

      <Card>
        <CardHeader>
          <CardTitle>记忆状态</CardTitle>
          {card?.suspended ? <Badge tone="success">已掌握</Badge> : null}
        </CardHeader>
        <CardBody className="space-y-1">
          <Row label="FSRS 状态" value={card ? FSRS_STATE_LABEL[card.state] : '未进入学习队列'} />
          <Row
            label="下次复习"
            value={card ? `${formatRelative(card.due)} / ${formatInterval(Date.now(), card.due)}后` : '—'}
          />
          <Row label="复习次数" value={card ? `${card.reps} 次` : '—'} />
          <Row label="遗忘次数" value={card ? `${card.lapses} 次` : '—'} />
          <Row
            label="记忆稳定性"
            value={card ? `${card.stability.toFixed(1)} 天` : '—'}
          />
          <Row label="词频排名" value={`#${word.freqRank}（真卷出现 ${word.freqCount} 次）`} />
          <Row label="真题例句" value={sentences.length > 0 ? `${sentences.length} 条` : '暂无（M2 补语料）'} />
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2 pb-4">
        <Button variant="secondary" onClick={(): void => tts.speak(word.headword)}>
          🔊 发音
        </Button>
        <Button variant={inVocab ? 'secondary' : 'primary'} onClick={(): void => void toggleVocab()}>
          {inVocab ? '★ 已在生词本' : '☆ 加入生词本'}
        </Button>
        <Button variant="ghost" onClick={(): void => void toggleMastered()}>
          {card?.suspended ? '取消「已掌握」' : '标记「已掌握」'}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}
