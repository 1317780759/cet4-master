import type { ReactNode } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { DbProvider } from '@/app/providers/DbProvider';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { WordSourceProvider } from '@/data/WordSourceProvider';
import { router } from '@/router';

/**
 * Provider 组合顺序（外层 → 内层）：
 * ErrorBoundary → Theme → Db → WordSource → Router
 *
 * Db 必须在 Router 之外：路由组件（含 BootstrapGate）一律假定数据库已打开。
 */
export function App(): ReactNode {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <DbProvider>
          <WordSourceProvider>
            <RouterProvider router={router} />
          </WordSourceProvider>
        </DbProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
