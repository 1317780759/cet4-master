import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { DbProvider } from '@/app/providers/DbProvider';
import { createDb, type Cet4Database } from '@/data/db/db';
import { bulkPutWords } from '@/data/repos/wordRepo';
import { ensureCard } from '@/data/repos/cardRepo';
import { addVocab } from '@/data/repos/vocabRepo';
import { addWrong } from '@/data/repos/wrongRepo';
import type { Word } from '@/domain/word/types';
import QuizPage from '@/features/quiz/QuizPage';
import WordBooksPage from '@/features/books/WordBooksPage';
import SettingsPage from '@/features/settings/SettingsPage';
import SearchPage from '@/features/search/SearchPage';

/**
 * 记忆闭环的三个新页面的冒烟测试。
 *
 * ★ 刻意测的是「能力可达」而非 UI 细节：这些页面此前**根本不存在**，
 *   所以最要紧的回归风险是"页面加好了但一渲染就白屏 / 出题出不出来"。
 *   出题与判分的算法由 generateQuiz / quizSession / quizPool 的单测覆盖，
 *   这里只验证流程串得起来。
 */

const NOW = 1_700_000_000_000;

function makeWord(i: number): Word {
  return {
    id: `w_smoke_${i}`,
    headword: `smoke${i}`,
    variants: [],
    senses: [{ pos: 'unknown', zh: `释义${i}` }],
    freqRank: 100 + i,
    freqCount: 50,
    tier: 'core2104',
    chunk: 1,
    sentenceCount: 0,
    source: 'exam-data/CETVocabulary@test',
    license: 'CC BY-NC-SA 4.0',
  };
}

const WORDS: Word[] = Array.from({ length: 8 }, (_, i) => makeWord(i));

function wrap(node: ReactNode, instance: Cet4Database): ReactNode {
  return (
    <MemoryRouter>
      <DbProvider instance={instance}>{node}</DbProvider>
    </MemoryRouter>
  );
}

/** 找到选项按钮（文本形如 "A 释义3"） */
function optionButton(key: string): HTMLElement {
  const found = screen.getAllByRole('button').find((b) => (b.textContent ?? '').trim().startsWith(key));
  if (!found) throw new Error(`找不到选项按钮 ${key}`);
  return found;
}

let db: Cet4Database;

beforeEach(async () => {
  db = createDb(`cet4-smoke-${Math.random().toString(36).slice(2)}`);
  await bulkPutWords(WORDS, db);
});

describe('测验页 /quiz', () => {
  it('能从已学词出题 → 作答 → 看到反馈', async () => {
    for (const w of WORDS) await ensureCard(w.id, w.freqRank, NOW, db);

    render(wrap(<QuizPage />, db));

    fireEvent.click(screen.getByText('开始测验'));

    await waitFor(() => {
      expect(screen.getByText(/第 1 \//)).toBeTruthy();
    });

    fireEvent.click(optionButton('A'));

    // 作答后必须给出即时反馈，否则用户不知道自己对没对
    await waitFor(() => {
      expect(screen.getByText(/答对了|答错了/)).toBeTruthy();
    });
  });

  it('词池为空时给出提示而不是白屏', async () => {
    render(wrap(<QuizPage />, db));
    fireEvent.click(screen.getByText('开始测验'));
    await waitFor(() => {
      expect(screen.getByText(/还没有词|可用题目不足/)).toBeTruthy();
    });
  });
});

describe('词本页 /books', () => {
  it('错词本列出错题，并可切到生词本', async () => {
    await addWrong(
      {
        wordId: WORDS[0]!.id,
        source: 'quiz',
        wrongCount: 2,
        firstWrongAt: NOW,
        lastWrongAt: NOW,
        enqueued: true,
        nextDue: NOW,
        resolved: false,
      },
      db,
    );
    await addVocab({ wordId: WORDS[1]!.id, now: NOW }, db);

    render(wrap(<WordBooksPage />, db));

    // 默认停在错词本
    await waitFor(() => {
      expect(screen.getByText('smoke0')).toBeTruthy();
    });
    expect(screen.getByText('错 2 次')).toBeTruthy();

    fireEvent.click(screen.getByText('生词本'));
    await waitFor(() => {
      expect(screen.getByText('smoke1')).toBeTruthy();
    });
  });
});

describe('查词页 /search', () => {
  it('输入前缀能查到词，并可一键加入生词本', async () => {
    render(wrap(<SearchPage />, db));

    fireEvent.change(screen.getByLabelText('搜索单词'), { target: { value: 'smoke' } });

    await waitFor(() => {
      expect(screen.getByText('smoke0')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('收藏 smoke0'));

    // 加入后星标变实心，且不再重复插入（addVocab 幂等）
    await waitFor(() => {
      expect(screen.getByLabelText('取消收藏 smoke0')).toBeTruthy();
    });

    // ★ 回归：已收藏之后必须还能再点一次取消掉。
    //   旧实现是 `if (starred.has(id)) return;` —— 单向的，点了没反应，永远取消不了。
    fireEvent.click(screen.getByLabelText('取消收藏 smoke0'));
    await waitFor(() => {
      expect(screen.getByLabelText('收藏 smoke0')).toBeTruthy();
    });
  });
});

describe('设置页 /settings', () => {
  it('改每日新词量会立刻反映到 UI（学习计划可调）', async () => {
    render(wrap(<SettingsPage />, db));

    await waitFor(() => {
      expect(screen.getByText('20 个')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('自定义新词量 增加'));

    await waitFor(() => {
      expect(screen.getByText('25 个')).toBeTruthy();
    });
  });
});
