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
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">真题练习</h1>
        <Badge tone="info">M2 进行中</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>写作 / 阅读 / 翻译 分板块计时练习</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <p>规划中的能力（本轮 domain 层已就绪，UI 组装待完成）：</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>板块与时长由卷面 sectionMeta 推导，不写死时长</li>
            <li>答题卡：分组、标记待定、跳题、断点续考</li>
            <li>客观题自动批改 + 分项表现（不出总分、不做成绩换算）</li>
            <li>听力本期停用，保留预留位（结果页显示占位卡）</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
