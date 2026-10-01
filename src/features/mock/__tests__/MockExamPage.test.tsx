import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { DbProvider } from '@/app/providers/DbProvider';
import { createDb, type Cet4Database } from '@/data/db/db';
import { putPaperBundle } from '@/data/repos/paperRepo';
import type { PaperBundle } from '@/data/sources/PaperSource';
import type { ExamPaper, ExamQuestion, ExamSection } from '@/domain/exam/types';
import MockExamPage from '@/features/mock/MockExamPage';

/**
 * 真题练习端到端冒烟（T-M2-04）。
 *
 * ★ 三条最要紧的断言：
 *   ① 板块由 `sectionMeta` 驱动 —— 听力被停用后**不出现**听力板块（K1）；
 *   ② 结果页**不出现任何总分 / 425 / 710**（DOM 级，与合规门禁同口径）；
 *   ③ 客观题分母显式展示（x / y），无样本时显示"无样本"而不是 0%。
 */

const PAPER_ID = 'E2E-2026-06-SET1';

function makeBundle(): PaperBundle {
  const paper: ExamPaper = {
    id: PAPER_ID,
    year: 2026,
    month: 6,
    setNo: 1,
    level: 'CET4',
    durationMin: 125,
    totalScore: 710,
    sectionMeta: [
      { id: `${PAPER_ID}:W`, kind: 'writing', order: 1, partLabel: 'Part I Writing', questionFrom: 1, questionTo: 1, durationHintSec: 1800, rawScore: 106.5 },
      // ★ 听力刻意保留在 sectionMeta 里：它被停用必须是 plan 算出来的，不是"压根没写"
      { id: `${PAPER_ID}:L`, kind: 'listening', order: 2, partLabel: 'Part II Listening', questionFrom: 2, questionTo: 26, durationHintSec: 1500, rawScore: 248.5 },
      { id: `${PAPER_ID}:R`, kind: 'reading', order: 3, partLabel: 'Part III Reading', questionFrom: 27, questionTo: 29, durationHintSec: 2400, rawScore: 248.5 },
      { id: `${PAPER_ID}:T`, kind: 'translation', order: 4, partLabel: 'Part IV Translation', questionFrom: 57, questionTo: 57, durationHintSec: 1800, rawScore: 106.5 },
    ],
    provenance: 'derived',
    provenanceLabel: '同源模拟卷',
    derivedFrom: 'CET4 公开考纲与真题语料统计',
    confidence: {
      level: 'medium',
      hasTranscript: false,
      hasAudio: false,
      hasExplanation: true,
      answerCrossChecked: false,
      spotCheckRatio: 1,
      doubtCount: 0,
    },
  };

  const sections: ExamSection[] = [
    { id: `${PAPER_ID}:W-A`, paperId: PAPER_ID, kind: 'writing', subPart: 'Writing', order: 1, questions: [] },
    { id: `${PAPER_ID}:R-A`, paperId: PAPER_ID, kind: 'reading', subPart: 'Passage One', order: 3, passage: { title: 'Test passage', paragraphs: ['Para one.', 'Para two.'] }, questions: [] },
    { id: `${PAPER_ID}:T-A`, paperId: PAPER_ID, kind: 'translation', subPart: 'Translation', order: 4, questions: [] },
  ];

  const questions: ExamQuestion[] = [
    { id: 'E1', paperId: PAPER_ID, sectionId: `${PAPER_ID}:W-A`, kind: 'essay', no: 1, score: 106.5, stem: 'Write an essay.', rubric: '切题 / 结构 / 语言' },
    // 听力题（no 2..3）必须在启用范围之外被排除
    { id: 'L1', paperId: PAPER_ID, sectionId: `${PAPER_ID}:L-A`, kind: 'choice', no: 2, score: 2, answer: 'A' },
    { id: 'R1', paperId: PAPER_ID, sectionId: `${PAPER_ID}:R-A`, kind: 'choice', no: 27, score: 2, stem: 'Q27?', options: ['A. a', 'B. b', 'C. c', 'D. d'], answer: 'B', keyWordHints: ['w_alpha'] },
    { id: 'R2', paperId: PAPER_ID, sectionId: `${PAPER_ID}:R-A`, kind: 'choice', no: 28, score: 2, stem: 'Q28?', options: ['A. a', 'B. b', 'C. c', 'D. d'], answer: 'B' },
    { id: 'R3', paperId: PAPER_ID, sectionId: `${PAPER_ID}:R-A`, kind: 'choice', no: 29, score: 2, stem: 'Q29?', options: ['A. a', 'B. b', 'C. c', 'D. d'], answer: 'B' },
    { id: 'T1', paperId: PAPER_ID, sectionId: `${PAPER_ID}:T-A`, kind: 'translation', no: 57, score: 106.5, stem: '把这段译成英文。', rubric: '忠实 / 通顺' },
  ];

  return { paper, sections, questions };
}

let db: Cet4Database;

function renderPage(): ReactNode {
  return (
    <MemoryRouter initialEntries={[`/mock?paper=${PAPER_ID}`]}>
      <DbProvider instance={db}>
        <MockExamPage />
      </DbProvider>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  db = createDb(`cet4-mock-${Math.random().toString(36).slice(2)}`);
  await putPaperBundle(makeBundle(), db);
});

describe('真题练习页 /mock', () => {
  it('板块只渲染启用项（听力被 plan 排除），并可作答交卷', async () => {
    render(renderPage());

    // 默认停在写作板块
    await waitFor(() => {
      expect(screen.getByText('第 1 题')).toBeTruthy();
    });

    // ★ K1：板块导航由 plan.slots 产出 —— 有写作/阅读/翻译，**没有听力**
    const tabs = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(tabs.some((t) => t.includes('阅读 27-29'))).toBe(true);
    expect(tabs.some((t) => t.includes('听力'))).toBe(false);

    // 切到阅读并作答
    const readingTab = screen.getAllByRole('button').find((b) => (b.textContent ?? '').includes('阅读'));
    fireEvent.click(readingTab!);

    await waitFor(() => {
      expect(screen.getByText('Test passage')).toBeTruthy();
    });

    const optionB = screen.getAllByRole('button').find((b) => (b.textContent ?? '').trim().startsWith('B'));
    expect(optionB).toBeTruthy();
    fireEvent.click(optionB!);

    fireEvent.click(screen.getByText('交卷'));

    await waitFor(() => {
      expect(screen.getByText('练习结果')).toBeTruthy();
    });

    // ★ 零总分口径：结果页不得出现 425 / 710 / 总分
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/710|425/);
    expect(body).not.toMatch(/总分/);

    // ★ 分母显式展示，而不是只有一个百分比
    expect(screen.getByText('1 / 3（33%）')).toBeTruthy();
    // 听力占位卡（Q5 决策：显式占位而非彻底隐藏）
    expect(body).toMatch(/听力/);
  });
});
