import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 内边距档位 */
  padded?: boolean;
  children?: ReactNode;
}

/**
 * 卡片 —— 纸面质感：细墨线边框 + 小圆角，**不用柔和投影**。
 * 满屏"圆角白卡 + shadow-sm + 冷灰描边"是模板脸的典型症状，
 * 这里用 1px 实线和小圆角做出"纸压在桌面上"的层次。
 */
export function Card({ className, padded = true, children, ...rest }: CardProps): ReactNode {
  return (
    <div
      className={cn(
        'rounded-md border border-slate-200 bg-surface',
        'dark:border-slate-800 dark:bg-slate-900',
        padded && 'p-4 sm:p-5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
}: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>{children}</div>
  );
}

export function CardTitle({ className, children }: HTMLAttributes<HTMLHeadingElement>): ReactNode {
  return (
    <h3
      className={cn(
        'font-display text-[15px] leading-none text-slate-900 dark:text-slate-100',
        className,
      )}
    >
      {children}
    </h3>
  );
}

export function CardBody({ className, children }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('text-sm text-slate-600 dark:text-slate-300', className)}>{children}</div>;
}
