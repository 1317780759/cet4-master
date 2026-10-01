import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card } from '@/ui/primitives';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义降级 UI；不传则用默认卡片 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 错误上报钩子（MVP 不接远端，只留扩展点） */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** 全局错误边界：任何一个页面组件崩溃都不能让整站白屏 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 生产环境可在此接入上报；MVP 保持静默，避免任何外发请求
    this.props.onError?.(error, info);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <h2 className="mb-2 text-base font-semibold text-slate-800 dark:text-slate-100">
            页面出错了
          </h2>
          <p className="mb-4 text-sm break-words text-slate-600 dark:text-slate-300">
            {error.message}
          </p>
          <Button onClick={this.reset} block>
            重新加载该页面
          </Button>
        </Card>
      </div>
    );
  }
}
