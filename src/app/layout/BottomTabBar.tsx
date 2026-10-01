import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';

interface TabItem {
  to: string;
  label: string;
  icon: string;
}

const TABS: TabItem[] = [
  { to: '/', label: '首页', icon: '⌂' },
  { to: '/learn', label: '背词', icon: 'A' },
  { to: '/review', label: '复习', icon: '↻' },
  { to: '/mock', label: '模考', icon: '⏱' },
  { to: '/papers', label: '套卷', icon: '▤' },
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
