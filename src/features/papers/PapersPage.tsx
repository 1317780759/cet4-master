import type { ReactNode } from 'react';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/ui/primitives';

/**
 * M0 占位页 —— 套卷列表与导入入口属于 M2。
 * `PaperSource` 接口与 `paperLoader` 骨架已就位（铁律 A4），届时只需补数据。
 */
export default function PapersPage(): ReactNode {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">真题套卷</h1>
        <Badge tone="info">M2 计划中</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>按套懒加载</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <ul className="list-disc space-y-1 pl-5">
            <li>目录页只取 papers/index.json（≈8 KB），进入某套才下载该套完整 JSON</li>
            <li>内置卷默认分发「真题同源模拟卷」（provenance='derived'）</li>
            <li>用户导入通道：自备 JSON 仅落本机 IndexedDB，永不上传</li>
            <li>铁律 A6：仓库内零音频文件，听力缺原声时走 TTS / 文本降级</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
