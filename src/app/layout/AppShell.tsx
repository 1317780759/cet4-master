import { Suspense, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomTabBar } from './BottomTabBar';
import { Spinner } from '@/ui/primitives';

/** 应用外壳：顶栏 + 路由出口（懒加载边界在这里）+ 底部 Tab */
export function AppShell(): ReactNode {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="flex-1 px-4 pt-4 pb-20">
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomTabBar />
    </div>
  );
}

function RouteFallback(): ReactNode {
  return (
    <div className="flex items-center justify-center py-16 text-slate-500 dark:text-slate-400">
      <Spinner className="mr-2" />
      <span className="text-sm">加载中…</span>
    </div>
  );
}
