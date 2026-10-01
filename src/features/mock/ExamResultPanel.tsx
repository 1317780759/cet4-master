import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ExamResultView, SectionResultCard } from '@/domain/exam/result';
import { formatDuration } from '@/lib/date';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from '@/ui/primitives';

/**
 * 结果面板。
 *
 * ★ 不可协商的口径（docs/03 / docs/04 第 4 章）：
 *   - **零总分、零分数换算** —— `ExamResultView` 结构上就没有总分字段可填，
 *     这里也就无处可显示。这是结构性防呆，不只是文案提醒。
 *   - 板块卡由 `view.sections` 驱动（K1），恢复听力后自动多一张占位卡。
 *   - 免责文案全部取自 `DISCLAIMER_TEXT`（经 `deriveResultView` 透传），
 *     UI **不得另抄一份**，否则口径漂移且门禁发现不了。
 */

const KIND_LABEL: Record<string, string> = {
  writing: '写作',
  listening: '听力',
  reading: '阅读',
  translation: '翻译',
};

export interface ExamResultPanelProps {
  view: ExamResultView;
  autoSubmitted: boolean;
}

export function ExamResultPanel({ view, autoSubmitted }: ExamResultPanelProps): ReactNode {
  const navigate = useNavigate();
  const { overview } = view;
  const ratePct = overview.objectiveRate === null ? null : Math.round(overview.objectiveRate * 100);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-16">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-50">练习结果</h1>
        {autoSubmitted ? <Badge tone="warning">时间到，已自动交卷</Badge> : null}
      </div>

      {/* —— 第 1 层：总述（无总分）—— */}
      <Card>
        <CardHeader>
          <CardTitle>总览</CardTitle>
          {ratePct === null ? (
            <Badge tone="neutral">无客观题样本</Badge>
          ) : (
            <Badge tone={ratePct >= 70 ? 'success' : ratePct >= 50 ? 'warning' : 'danger'}>
              客观题正确率 {ratePct}%
            </Badge>
          )}
        </CardHeader>
        <CardBody className="space-y-1">
          <Row label="已作答" value={`${overview.answered} / ${overview.total} 题`} />
          <Row
            label="客观题答对"
            value={`${overview.objectiveCorrect} / ${overview.objectiveTotal} 题`}
          />
          <Row label="用时" value={formatDuration(overview.elapsedSec)} />
          <Row label="错题入复习" value={`${view.recycled.wrongCount} 题`} />
          <Row label="生词入词本" value={`${view.recycled.newWordCount} 个`} />
        </CardBody>
      </Card>

      {/* —— 第 2 层：板块明细（K1 驱动）—— */}
      <Card>
        <CardHeader>
          <CardTitle>分项表现</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {view.sections.map((card) => (
            <SectionRow key={`${card.sectionKind}-${card.label}`} card={card} />
          ))}
        </CardBody>
      </Card>

      {/* —— 第 3 层：免责与缺失声明 —— */}
      <Card>
        <CardBody className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">{view.disclaimers.objectiveOnlyNote}</p>
          {view.sections.some((s) => s.kind === 'disabled') ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {view.disclaimers.listeningDisabled}
            </p>
          ) : null}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {view.disclaimers.resultCopyright}
          </p>
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button block variant="secondary" onClick={(): void => { void navigate('/books'); }}>
          去错题本
        </Button>
        <Button block onClick={(): void => { void navigate('/papers'); }}>
          换一套卷
        </Button>
      </div>
      <Button block variant="ghost" onClick={(): void => { void navigate('/'); }}>
        返回首页
      </Button>
    </div>
  );
}

function SectionRow({ card }: { card: SectionResultCard }): ReactNode {
  const label = KIND_LABEL[card.sectionKind] ?? card.sectionKind;

  if (card.kind === 'disabled') {
    return (
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          🎧 {label} · {card.label}
        </span>
        <Badge tone="neutral">{card.note}</Badge>
      </div>
    );
  }

  if (card.kind === 'subjective') {
    return (
      <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
        <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {card.selfScore === null ? '未自评' : `自评 ${card.selfScore}`}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
      <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
      {/* ★ 分母必须显式展示（docs/03：22/30 而不是 73%）；无样本时显示"无样本"而不是 0% */}
      <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
        {card.rate === null ? '无样本' : `${card.correct} / ${card.total}（${Math.round(card.rate * 100)}%）`}
      </span>
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
