import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * 线性图标（手写 SVG，24 栅格，stroke 用 currentColor）。
 * ★ 刻意不用 emoji / ⌂↻▤ 这类字符当图标：
 *   字符字形随系统字体变化，粗细和基线对不齐，是"廉价感"的主要来源。
 */
const ICONS: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3.5 10.6 12 3.8l8.5 6.8" />
      <path d="M5.8 9.4V20h12.4V9.4" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  cards: (
    <>
      <path d="M4 7.5 12 3.5l8 4-8 4-8-4Z" />
      <path d="M4 12.5l8 4 8-4" />
      <path d="M4 17l8 4 8-4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20.5 4.5v4h-4" />
    </>
  ),
  quiz: (
    <>
      <path d="M5 4.5h14v15H5z" />
      <path d="M8.5 12.5l2.2 2.2 4.8-5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.6A1.6 1.6 0 0 1 5.6 4H11v16H5.6A1.6 1.6 0 0 1 4 18.4z" />
      <path d="M11 4h7.4A1.6 1.6 0 0 1 20 5.6v12.8a1.6 1.6 0 0 1-1.6 1.6H11" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8.5" r="3.4" />
      <path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" />
    </>
  ),
};

interface TabItem {
  to: string;
  label: string;
  icon: keyof typeof ICONS;
}

/**
 * ★ 六个 Tab 的取舍：背词 / 复习 / 测验 / 词本 是记忆闭环的四步，全都在一级入口；
 *   真题（模考、套卷）是低频长时操作，退到首页卡片进入，避免挤占一级位置。
 */
const TABS: TabItem[] = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/learn', label: '背词', icon: 'cards' },
  { to: '/review', label: '复习', icon: 'refresh' },
  { to: '/quiz', label: '测验', icon: 'quiz' },
  { to: '/books', label: '词本', icon: 'book' },
  { to: '/settings', label: '我的', icon: 'me' },
];

/** 底部导航 —— 移动端单手可达（PRD R04 的容器层保障） */
export function BottomTabBar(): ReactNode {
  return (
    <nav
      className={cn(
        'pb-safe fixed inset-x-0 bottom-0 z-20 flex h-14 items-stretch',
        'border-t border-slate-200 bg-surface dark:border-slate-800 dark:bg-slate-900',
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
              'relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors',
              isActive
                ? 'text-brand-700 dark:text-brand-300'
                : 'text-slate-500 dark:text-slate-400',
            )
          }
        >
          {({ isActive }): ReactNode => (
            <>
              {/* 激活态顶部一小段朱红横线：比"只换个颜色"更像真的导航控件 */}
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-600"
                />
              ) : null}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-[22px] w-[22px]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICONS[tab.icon]}
              </svg>
              <span className="text-[11px] leading-none">{tab.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
