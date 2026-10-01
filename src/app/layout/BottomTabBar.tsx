import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';

interface TabItem {
  to: string;
  label: string;
  icon: string;
}

/**
 * ★ 六个 Tab 的取舍：背词 / 复习 / 测验 / 词本 是记忆闭环的四步，全都在一级入口；
 *   真题（模考、套卷）是低频长时操作，退到首页卡片进入，避免挤占一级位置。
 */
const TABS: TabItem[] = [
  { to: '/', label: '首页', icon: '⌂' },
  { to: '/learn', label: '背词', icon: 'A' },
  { to: '/review', label: '复习', icon: '↻' },
  { to: '/quiz', label: '测验', icon: '✓' },
  { to: '/books', label: '词本', icon: '▤' },
  { to: '/settings', label: '我的', icon: '⚙' },
];

/** 底部导航 —— 移动端单手可达（PRD R04 的容器层保障） */
export function BottomTabBar(): ReactNode {
  return (
    <nav
      className={cn(
        'pb-safe fixed inset-x-0 bottom-0 z-20 flex h-14 items-stretch',
        'border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      )}
      aria-label="主导航"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }): string =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors',
              isActive
                ? 'text-brand-600 dark:text-brand-400'
                : 'text-slate-500 dark:text-slate-400',
            )
          }
        >
          <span aria-hidden="true" className="text-base leading-none">
            {tab.icon}
          </span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
