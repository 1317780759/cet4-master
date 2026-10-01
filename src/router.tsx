import { lazy } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/app/layout/AppShell';
import { BootstrapGate } from '@/app/providers/BootstrapGate';

/**
 * 路由表 —— 每个页面都是一个懒加载边界，
 * 保证「真题模块变大」不会拖累首屏预算（/mock 与 /papers 各自独立分包）。
 */
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const LearnPage = lazy(() => import('@/features/learn/LearnPage'));
const ReviewPage = lazy(() => import('@/features/learn/ReviewPage'));
const QuizPage = lazy(() => import('@/features/quiz/QuizPage'));
const WordBooksPage = lazy(() => import('@/features/books/WordBooksPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const WordDetailPage = lazy(() => import('@/features/word-detail/WordDetailPage'));
const MockExamPage = lazy(() => import('@/features/mock/MockExamPage'));
const PapersPage = lazy(() => import('@/features/papers/PapersPage'));
const NotFoundPage = lazy(() => import('@/features/NotFoundPage'));

/** GH Pages 子路径部署时的 basename（去掉结尾斜杠） */
export function appBasename(): string {
  const raw = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  if (!raw || raw === '/') return '/';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <BootstrapGate>
        <AppShell />
      </BootstrapGate>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'learn', element: <LearnPage /> },
      { path: 'review', element: <ReviewPage /> },
      { path: 'quiz', element: <QuizPage /> },
      { path: 'books', element: <WordBooksPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'word/:id', element: <WordDetailPage /> },
      { path: 'mock', element: <MockExamPage /> },
      { path: 'papers', element: <PapersPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: appBasename() });
