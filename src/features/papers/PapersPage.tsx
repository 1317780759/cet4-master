import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BuiltinPaperSource } from '@/data/sources/BuiltinPaperSource';
import type { PaperSummary, PapersIndexFile } from '@/data/sources/PaperSource';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from '@/ui/primitives';

/**
 * 套卷列表页 —— 只取 `papers/index.json`（≈8 KB），进入某套才下载该套完整 JSON。
 *
 * ★ 减损措施④（docs/02 §3.6.5）：`killSwitch.disabled = true` 时**整站下线**内置卷，
 *   这里必须如实展示原因而不是静默显示空列表（静默 = 用户以为是自己没数据）。
 */

const PROVENANCE_LABEL: Record<string, string> = {
  original: '第三方整理卷',
  derived: '同源模拟卷',
  'user-imported': '自行导入',
};

export default function PapersPage(): ReactNode {
  const navigate = useNavigate();
  const [index, setIndex] = useState<PapersIndexFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const source = new BuiltinPaperSource();
        const file = (await source.readIndex?.()) ?? {
          defaultMissingAudio: true,
          papers: [],
          killSwitch: { disabled: false },
        };
        if (!cancelled) setIndex(file);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '读取套卷目录失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        正在读取套卷目录…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>读取失败</CardTitle>
          </CardHeader>
          <CardBody>{error}</CardBody>
        </Card>
      </div>
    );
  }

  const papers = index?.papers ?? [];
  const killed = index?.killSwitch?.disabled === true;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-16">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">真题套卷</h1>
        <Badge tone="neutral">{papers.length} 套</Badge>
      </div>

      {killed ? (
        <Card>
          <CardHeader>
            <CardTitle>内置卷已下线</CardTitle>
            <Badge tone="danger">killSwitch</Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-sm">
              {index?.killSwitch?.reason ?? '应权利人要求，本站已停止分发内置真题卷。'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              你的学习进度不受影响；可改用自行导入的卷继续练习。
            </p>
          </CardBody>
        </Card>
      ) : null}

      {!killed && papers.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>暂无套卷</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-sm">还没有内置卷 —— 可在设置里导入自备的套卷 JSON。</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
              <li>目录页只取 papers/index.json，进入某套才下载该套完整 JSON</li>
              <li>用户导入通道：自备 JSON 仅落本机 IndexedDB，永不上传</li>
              <li>铁律 A6：仓库内零音频文件，听力缺原声时走 TTS / 文本降级</li>
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {!killed
        ? papers.map((paper) => <PaperRow key={paper.id} paper={paper} onStart={navigate} />)
        : null}
    </div>
  );
}

function PaperRow({
  paper,
  onStart,
}: {
  paper: PaperSummary;
  onStart: (to: string) => void;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {paper.year} 年 {paper.month} 月 · 第 {paper.setNo} 套
        </CardTitle>
        <Badge tone={paper.provenance === 'derived' ? 'info' : 'neutral'}>
          {PROVENANCE_LABEL[paper.provenance] ?? paper.provenanceLabel}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{paper.questionCount} 题</span>
          <span>·</span>
          <span>置信度 {paper.confidenceLevel}</span>
          {paper.hasAudio ? null : (
            <>
              <span>·</span>
              <span>无音频（铁律 A6）</span>
            </>
          )}
        </div>
        <Button block onClick={(): void => onStart(`/mock?paper=${encodeURIComponent(paper.id)}`)}>
          开始练习
        </Button>
      </CardBody>
    </Card>
  );
}
