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
const SearchPage = lazy(() => import('@/features/search/SearchPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const WordDetailPage = lazy(() => import('@/features/word-detail/WordDetailPage'));
const MockExamPage = lazy(() => import('@/features/mock/MockExamPage'));
const PapersPage = lazy(() => import('@/features/papers/PapersPage'));
// ★ 翻译训练三条路由各自独立分包：这是唯一"按需下载题库 JSON"的模块，
//   绝不能进主bundle，否则首屏预算被拖垮。
const TranslationHomePage = lazy(() => import('@/features/translation/TranslationHomePage'));
const TranslationPracticePage = lazy(() => import('@/features/translation/TranslationPracticePage'));
const TranslationBookPage = lazy(() => import('@/features/translation/TranslationBookPage'));
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
      { path: 'search', element: <SearchPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'word/:id', element: <WordDetailPage /> },
      { path: 'mock', element: <MockExamPage /> },
      { path: 'papers', element: <PapersPage /> },
      { path: 'translation', element: <TranslationHomePage /> },
      { path: 'translation/practice', element: <TranslationPracticePage /> },
      { path: 'translation/book', element: <TranslationBookPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: appBasename() });
