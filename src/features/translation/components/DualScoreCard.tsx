import type { ReactNode } from 'react';
import type { LlmCorrection, LlmReview } from '@/domain/llm/parse';
import { BAND_TABLE } from '@/domain/translation/scorer';
import type { Band, ScoreResult } from '@/domain/translation/types';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/ui/primitives';

/**
 * 双评分并列展示（docs/04b §5.14.7）。
 *
 * ★ 核心不变量：**离线卡恒定渲染，永不消失**。
 *   AI 是增强不是依赖 —— 断网 / Key 失效 / 服务不可用时，用户看到的仍然是一份
 *   完整、可用的评分，而不是一个错误页或空白。
 *
 * 三态：
 * - 未开启 → 整卡不渲染，离线卡下方给一行"去设置页开启"的引导
 * - 进行中 → 卡内 `AI 批改中…` + 流式预览（预览文本**绝不能**当分数展示）
 * - 失败   → 卡内一行错误文案（文案自带"已用离线评分"），非模态、不阻断
 */

export type AiCardState =
  | { kind: 'off' }
  | { kind: 'pending'; preview: string }
  | { kind: 'done'; review: LlmReview }
  | { kind: 'failed'; message: string };

export interface DualScoreCardProps {
  offline: ScoreResult;
  ai: AiCardState;
}

/** 档位 → 中文标签（取自 BAND_TABLE，★ 不称"官方评分"） */
export function bandLabel(band: Band): string {
  return BAND_TABLE.find((r) => r.band === band)?.label ?? '';
}

export function DualScoreCard({ offline, ai }: DualScoreCardProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start">
      <div className="w-full md:w-1/2">
        <OfflineCard score={offline} />
        {ai.kind === 'off' ? (
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            开启 AI 批改可获得逐句纠错（设置页 · 需自带 Key）
          </p>
        ) : null}
      </div>
      {ai.kind !== 'off' ? (
        <div className="w-full md:w-1/2">
          <AiCard state={ai} />
        </div>
      ) : null}
    </div>
  );
}

function OfflineCard({ score }: { score: ScoreResult }): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>离线评分</CardTitle>
        <Badge tone="neutral">{bandLabel(score.band)}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="font-display text-2xl leading-none text-slate-900 tabular dark:text-slate-50">
          命中 {score.hit} / {score.total}
        </p>
        <ul className="space-y-1">
          {score.points.map((point) => (
            <li key={point.id} className="flex items-start gap-2 text-xs">
              <span className={point.hit ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>
                {point.hit ? '✓' : '✗'}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-slate-700 dark:text-slate-200">{point.head}</span>
                <span className="ml-1 text-slate-500 dark:text-slate-400">{point.zh}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-400 dark:text-slate-500">本地关键词匹配 · 无需网络</p>
      </CardBody>
    </Card>
  );
}

const CORRECTION_TYPE_LABEL: Record<LlmCorrection['type'], string> = {
  grammar: '语法',
  spelling: '拼写',
  'word-choice': '用词',
  'missing-info': '漏译',
  'word-order': '语序',
  punctuation: '标点',
  capitalization: '大小写',
};

function AiCard({ state }: { state: Exclude<AiCardState, { kind: 'off' }> }): ReactNode {
  if (state.kind === 'pending') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI 批改</CardTitle>
          <Badge tone="warning">进行中</Badge>
        </CardHeader>
        <CardBody className="space-y-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">AI 批改中…</p>
          {state.preview ? (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              {state.preview}
            </pre>
          ) : null}
          <AiDisclaimer />
        </CardBody>
      </Card>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI 批改</CardTitle>
          <Badge tone="neutral">不可用</Badge>
        </CardHeader>
        <CardBody className="space-y-2">
          {/* 🔴 非模态、不阻断：message 本身就是完整的安抚句
              （「AI Key 无效或没有该模型权限，已用离线评分」），不再叠加前缀 */}
          <p className="text-sm text-slate-600 dark:text-slate-300">{state.message}</p>
          <AiDisclaimer />
        </CardBody>
      </Card>
    );
  }

  const { review } = state;
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 批改</CardTitle>
        <Badge tone="neutral">{bandLabel(review.band)}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="font-display text-2xl leading-none text-slate-900 tabular dark:text-slate-50">
          {review.score} 分 / 15
        </p>

        {review.corrections.length > 0 ? (
          <ul className="space-y-2">
            {review.corrections.map((c, i) => (
              <li key={`${c.original}-${i}`} className="border-b border-slate-100 pb-2 text-xs last:border-0 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Badge tone="danger">{CORRECTION_TYPE_LABEL[c.type]}</Badge>
                  <span className="text-slate-400 line-through dark:text-slate-500">{c.original}</span>
                </div>
                <div className="mt-1 text-slate-700 dark:text-slate-200">{c.suggested}</div>
                {c.note ? <div className="mt-0.5 text-slate-500 dark:text-slate-400">{c.note}</div> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {review.highlights.length > 0 ? (
          <div className="text-xs">
            <span className="text-slate-500 dark:text-slate-400">亮点：</span>
            <span className="text-slate-700 dark:text-slate-200">{review.highlights.join('；')}</span>
          </div>
        ) : null}

        {review.advice ? (
          <div className="text-xs">
            <span className="text-slate-500 dark:text-slate-400">建议：</span>
            <span className="text-slate-700 dark:text-slate-200">{review.advice}</span>
          </div>
        ) : null}

        <AiDisclaimer />
      </CardBody>
    </Card>
  );
}

/** 🔴 固定免责声明，逐字呈现，不得改写（docs/04b §5.14.7） */
function AiDisclaimer(): ReactNode {
  return (
    <p className="text-[11px] text-slate-400 dark:text-slate-500">
      AI 批改由第三方模型生成，仅供参考，不代表四级官方评分。
    </p>
  );
}
