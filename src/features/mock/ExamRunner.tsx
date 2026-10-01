import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { questionsInPlan } from '@/domain/exam/sectionPlan';
import type { AnswerRecord, ExamQuestion } from '@/domain/exam/types';
import type { PaperBundle } from '@/data/sources/PaperSource';
import type { ExamSession } from '@/services/examSession';
import { formatDuration } from '@/lib/date';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Progress, Segmented } from '@/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * 真题练习运行器。
 *
 * ★ 三条硬约束（docs/04 第 2 章 K1–K3，违反等于把听力写死在代码里）：
 *   - **K1** 板块只遍历 `plan.slots`（源自 sectionMeta），不写 `['writing','reading','translation']`
 *   - **K2** 倒计时只取 `plan.totalSec`，不写 `const TOTAL = 100 * 60`
 *   - **K3** 答题卡分组 / 题号区间只读 `slot.questionFrom/To`
 *   恢复听力只需改 `DEFAULT_DISABLED_SECTIONS`，本文件**一行都不用动**。
 */

export interface ExamRunnerProps {
  session: ExamSession;
  bundle: PaperBundle;
  onSubmit: (reason: 'manual' | 'auto') => void;
}

const KIND_LABEL: Record<string, string> = {
  writing: '写作',
  listening: '听力',
  reading: '阅读',
  translation: '翻译',
};

export function ExamRunner({ session, bundle, onSubmit }: ExamRunnerProps): ReactNode {
  const plan = session.plan;
  const questions = useMemo(
    () => questionsInPlan(bundle.questions, plan).slice().sort((a, b) => a.no - b.no),
    [bundle.questions, plan],
  );

  const [answers, setAnswers] = useState<Record<string, AnswerRecord>>(
    () => session.snapshot().answers,
  );
  const [slotIndex, setSlotIndex] = useState(0);
  const [remainingSec, setRemainingSec] = useState<number | null>(
    () => session.snapshot().remainingSec,
  );
  const [showSheet, setShowSheet] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // —— 计时：每秒一个 tick（ticks 累加，不用 Date 差值，见 examSession 注释）——
  useEffect(() => {
    if (remainingSec === null) return undefined;
    const timer = setInterval((): void => {
      const { remainingSec: rest, expired } = session.tick(1);
      setRemainingSec(rest);
      if (expired) {
        setSubmitting(true);
        void session.flush().then((): void => onSubmit('auto'));
      }
    }, 1000);
    return (): void => clearInterval(timer);
  }, [session, remainingSec, onSubmit]);

  const slot = plan.slots[slotIndex];
  const slotQuestions = useMemo(
    () => (slot ? questions.filter((q) => q.no >= slot.questionFrom && q.no <= slot.questionTo) : []),
    [questions, slot],
  );

  const answeredCount = useMemo(
    () => questions.filter((q) => answers[q.id]?.flag === 'answered').length,
    [questions, answers],
  );

  const submit = useCallback((): void => {
    setSubmitting(true);
    void session.flush().then((): void => onSubmit('manual'));
  }, [session, onSubmit]);

  const answer = useCallback(
    (questionId: string, value: string | null): void => {
      void session.answer(questionId, value).then((): void => {
        setAnswers({ ...session.snapshot().answers });
      });
    },
    [session],
  );

  const toggleDoubt = useCallback(
    (questionId: string): void => {
      const current = answers[questionId];
      void session.markDoubtful(questionId, current?.doubtful !== true, 'answer-wrong').then((): void => {
        setAnswers({ ...session.snapshot().answers });
      });
    },
    [answers, session],
  );

  const toggleMark = useCallback(
    (questionId: string): void => {
      const current = answers[questionId];
      void session.mark(questionId, current?.flag === 'marked' ? 'answered' : 'marked').then((): void => {
        setAnswers({ ...session.snapshot().answers });
      });
    },
    [answers, session],
  );

  if (!slot) {
    return <p className="p-8 text-sm text-slate-500">这套卷没有可练的板块。</p>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-16">
      {/* —— 顶部：倒计时 + 进度 —— */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-50">真题练习</h1>
        <div className="flex items-center gap-2">
          <Badge tone={remainingSec !== null && remainingSec < 300 ? 'danger' : 'info'}>
            {remainingSec === null ? '不限时' : `剩余 ${formatDuration(remainingSec)}`}
          </Badge>
          <Button size="sm" variant="ghost" onClick={(): void => setShowSheet(!showSheet)}>
            答题卡
          </Button>
        </div>
      </div>

      <Progress
        value={questions.length === 0 ? 0 : answeredCount / questions.length}
        label={`已作答 ${answeredCount} / ${questions.length}`}
      />

      {/* —— 板块导航（K1：遍历 plan.slots）—— */}
      <Segmented
        ariaLabel="板块"
        block
        size="sm"
        options={plan.slots.map((s, i) => ({
          value: String(i),
          label: `${KIND_LABEL[s.meta.kind] ?? s.meta.kind} ${s.questionFrom}-${s.questionTo}`,
        }))}
        value={String(slotIndex)}
        onChange={(v): void => setSlotIndex(Number(v))}
      />

      {/* —— 答题卡（K3：区间只认 slot.questionFrom/To）—— */}
      {showSheet ? (
        <Card>
          <CardBody>
            <div className="flex flex-wrap gap-1.5">
              {questions.map((q) => {
                const rec = answers[q.id];
                const done = rec?.flag === 'answered' || rec?.flag === 'marked';
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={(): void => {
                      const idx = plan.slots.findIndex((s) => q.no >= s.questionFrom && q.no <= s.questionTo);
                      if (idx >= 0) setSlotIndex(idx);
                    }}
                    className={cn(
                      'inline-flex h-8 w-8 items-center justify-center rounded text-xs',
                      done
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                      rec?.doubtful === true && 'ring-2 ring-amber-400',
                      rec?.flag === 'marked' && 'ring-2 ring-sky-400',
                    )}
                  >
                    {q.no}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              蓝框 = 标记待定，黄框 = 存疑（存疑题的错题不会进复习计划）
            </p>
          </CardBody>
        </Card>
      ) : null}

      {/* —— 篇章材料（阅读）—— */}
      <PassageBlock bundle={bundle} kind={slot.meta.kind} />

      {/* —— 题目 —— */}
      {slotQuestions.map((q) => (
        <QuestionBlock
          key={q.id}
          question={q}
          record={answers[q.id]}
          onAnswer={answer}
          onToggleDoubt={toggleDoubt}
          onToggleMark={toggleMark}
        />
      ))}

      {slotIndex + 1 < plan.slots.length ? (
        <Button block size="lg" onClick={(): void => setSlotIndex(slotIndex + 1)}>
          下一板块：{KIND_LABEL[plan.slots[slotIndex + 1]!.meta.kind] ?? '下一项'}
        </Button>
      ) : null}

      <Button block size="lg" variant="secondary" loading={submitting} onClick={submit}>
        交卷
      </Button>
    </div>
  );
}

/** 篇章材料：只在该板块确有待读材料时渲染（不硬编码"阅读才有篇章"） */
function PassageBlock({ bundle, kind }: { bundle: PaperBundle; kind: string }): ReactNode {
  const section = bundle.sections.find((s) => s.kind === kind && s.passage);
  if (!section?.passage) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.passage.title ?? section.subPart}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        {section.passage.paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            {p}
          </p>
        ))}
      </CardBody>
    </Card>
  );
}

function QuestionBlock({
  question,
  record,
  onAnswer,
  onToggleDoubt,
  onToggleMark,
}: {
  question: ExamQuestion;
  record: AnswerRecord | undefined;
  onAnswer: (questionId: string, value: string | null) => void;
  onToggleDoubt: (questionId: string) => void;
  onToggleMark: (questionId: string) => void;
}): ReactNode {
  const isSubjective = question.kind === 'essay' || question.kind === 'translation';
  const value = record?.value ?? '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>第 {question.no} 题</CardTitle>
        <div className="flex items-center gap-1">
          {record?.doubtful === true ? <Badge tone="warning">存疑</Badge> : null}
          {record?.flag === 'marked' ? <Badge tone="info">待定</Badge> : null}
          {isSubjective ? <Badge tone="neutral">主观题 · 自评</Badge> : null}
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {question.stem ? (
          <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">
            {isSubjective && question.kind === 'translation' ? (
              <span className="font-medium">{question.stem}</span>
            ) : (
              question.stem
            )}
          </p>
        ) : null}

        {question.options && question.options.length > 0 ? (
          <div className="space-y-2">
            {question.options.map((opt) => {
              const key = opt.split(/[.．、]\s*/)[0]?.trim() ?? opt;
              const active = value === key;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={(): void => onAnswer(question.id, active ? null : key)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    active
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
                      : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="shrink-0 font-medium text-slate-500 dark:text-slate-400">{key}</span>
                  <span className="text-slate-900 dark:text-slate-50">
                    {opt.replace(/^[A-Da-d][.．、]\s*/, '')}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {isSubjective ? (
          <textarea
            value={value}
            onChange={(e): void => onAnswer(question.id, e.target.value)}
            rows={question.kind === 'essay' ? 8 : 5}
            placeholder={question.kind === 'essay' ? '在此写作…' : '在此翻译…'}
            aria-label={`第 ${question.no} 题作答`}
            className={[
              'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm',
              'text-slate-900 placeholder:text-slate-400',
              'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
              'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50',
            ].join(' ')}
          />
        ) : null}

        {question.rubric ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">评分参考：{question.rubric}</p>
        ) : null}

        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={(): void => onToggleMark(question.id)}>
            {record?.flag === 'marked' ? '取消待定' : '标记待定'}
          </Button>
          <Button size="sm" variant="ghost" onClick={(): void => onToggleDoubt(question.id)}>
            {record?.doubtful === true ? '取消存疑' : '答案存疑'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
