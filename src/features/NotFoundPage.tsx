import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '@/ui/primitives';

export default function NotFoundPage(): ReactNode {
  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <h1 className="mb-2 text-base font-semibold text-slate-800 dark:text-slate-100">
          页面不存在
        </h1>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          你访问的地址没有对应的页面。
        </p>
        <Link to="/">
          <Button block>回到首页</Button>
        </Link>
      </Card>
    </div>
  );
}
