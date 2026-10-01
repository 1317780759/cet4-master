import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 内边距档位 */
  padded?: boolean;
  children?: ReactNode;
}

export function Card({ className, padded = true, children, ...rest }: CardProps): ReactNode {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm',
        'dark:border-slate-700 dark:bg-slate-900',
        padded && 'p-4',
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
    <div className={cn('mb-2 flex items-center justify-between gap-2', className)}>{children}</div>
  );
}

export function CardTitle({ className, children }: HTMLAttributes<HTMLHeadingElement>): ReactNode {
  return (
    <h3
      className={cn('text-sm font-semibold text-slate-700 dark:text-slate-200', className)}
    >
      {children}
    </h3>
  );
}

export function CardBody({ className, children }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('text-sm text-slate-600 dark:text-slate-300', className)}>{children}</div>;
}
