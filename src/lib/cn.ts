import clsx, { type ClassValue } from 'clsx';

/**
 * className 合并工具 —— 项目内唯一的类名拼接入口。
 * 包一层是为了将来若要接入 tailwind-merge（解决冲突类）时只改一处。
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
