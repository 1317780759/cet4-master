import { Suspense, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomTabBar } from './BottomTabBar';
import { Spinner } from '@/ui/primitives';

/** 应用外壳：顶栏 + 路由出口（懒加载边界在这里）+ 底部 Tab */
export function AppShell(): ReactNode {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      {/* ★ 底部留白必须含安全区：iPhone 的 home indicator 有 ~34px，
          只留 5rem 会被 TabBar 压住最后一张卡 */}
      <main className="flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">
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
