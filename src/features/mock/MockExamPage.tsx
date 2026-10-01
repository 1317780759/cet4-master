import type { ReactNode } from 'react';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/ui/primitives';

/**
 * M0 占位页 —— 完整套卷模考属于 M2。
 * 路由 / 懒加载边界 / 外壳已就绪，本轮不实现任何业务逻辑。
 */
export default function MockExamPage(): ReactNode {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">完整模考</h1>
        <Badge tone="info">M2 计划中</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>这里将是 125 分钟完整模考</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <p>规划中的能力（本轮均未实现）：</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>写作 / 听力 / 阅读 / 翻译四板块分段倒计时</li>
            <li>答题卡：分组、标记待定、跳题、断点续考</li>
            <li>客观题自动批改 + 分项得分（不做 710 分制换算）</li>
            <li>听力四态与 TTS 降级（受铁律 A6「音频零入库」约束）</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
