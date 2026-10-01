import { createDb, type Cet4Database } from '@/data/db/db';
import { putPaperBundle } from '@/data/repos/paperRepo';
import type { ExamPaper, ExamQuestion, ExamSection } from '@/domain/exam/types';

/**
 * 真题会话单测的共享夹具。
 *
 * 卷面刻意保留**听力**板块（order=2, 题号 2..26）：
 * 这样「启用板块之外的题必须被排除」才是被真实测到的，而不是靠"压根没有听力题"蒙混过关。
 */

export const PAPER_ID = 'TEST-2026-06-SET1';

export function makePaper(): ExamPaper {
  return {
    id: PAPER_ID,
    year: 2026,
    month: 6,
    setNo: 1,
    level: 'CET4',
    durationMin: 125,
    totalScore: 710,
    sectionMeta: [
      { id: `${PAPER_ID}:W`, kind: 'writing', order: 1, partLabel: 'Part I Writing', questionFrom: 1, questionTo: 1, durationHintSec: 30 * 60, rawScore: 106.5 },
      { id: `${PAPER_ID}:L`, kind: 'listening', order: 2, partLabel: 'Part II Listening', questionFrom: 2, questionTo: 26, durationHintSec: 25 * 60, rawScore: 248.5 },
      { id: `${PAPER_ID}:R`, kind: 'reading', order: 3, partLabel: 'Part III Reading', questionFrom: 27, questionTo: 56, durationHintSec: 40 * 60, rawScore: 248.5 },
      { id: `${PAPER_ID}:T`, kind: 'translation', order: 4, partLabel: 'Part IV Translation', questionFrom: 57, questionTo: 57, durationHintSec: 30 * 60, rawScore: 106.5 },
    ],
    provenance: 'derived',
    provenanceLabel: '同源模拟卷',
    confidence: {
      level: 'medium',
      hasTranscript: false,
      hasAudio: false,
      hasExplanation: true,
      answerCrossChecked: false,
      spotCheckRatio: 0.1,
      doubtCount: 0,
    },
  };
}

export function makeSections(): ExamSection[] {
  // 题目单独存在 questions 表并按 paperId 查询，section.questions 在夹具里留空
  return [
    { id: `${PAPER_ID}:W-A`, paperId: PAPER_ID, kind: 'writing', subPart: 'Writing', order: 1, questions: [] },
    { id: `${PAPER_ID}:L-A`, paperId: PAPER_ID, kind: 'listening', subPart: 'Section A', order: 2, questions: [] },
    { id: `${PAPER_ID}:R-A`, paperId: PAPER_ID, kind: 'reading', subPart: 'Section A', order: 3, questions: [] },
    { id: `${PAPER_ID}:T-A`, paperId: PAPER_ID, kind: 'translation', subPart: 'Translation', order: 4, questions: [] },
  ];
}

/** 客观题标准答案全为 'B'；听力题（no 2..26）在启用范围之外 */
export const READING_COUNT = 5;

export function makeQuestions(): ExamQuestion[] {
  const qs: ExamQuestion[] = [
    { id: 'E1', paperId: PAPER_ID, sectionId: `${PAPER_ID}:W-A`, kind: 'essay', no: 1, score: 106.5, rubric: '切题/结构/语言' },
    { id: 'L1', paperId: PAPER_ID, sectionId: `${PAPER_ID}:L-A`, kind: 'choice', no: 2, score: 2, answer: 'A' },
    { id: 'L2', paperId: PAPER_ID, sectionId: `${PAPER_ID}:L-A`, kind: 'choice', no: 3, score: 2, answer: 'A' },
  ];
  for (let i = 0; i < READING_COUNT; i += 1) {
    qs.push({
      id: `R${i}`,
      paperId: PAPER_ID,
      sectionId: `${PAPER_ID}:R-A`,
      kind: 'choice',
      no: 27 + i,
      score: 2,
      answer: 'B',
      keyWordHints: i === 0 ? ['w_alpha'] : [],
    });
  }
  qs.push({ id: 'T1', paperId: PAPER_ID, sectionId: `${PAPER_ID}:T-A`, kind: 'translation', no: 57, score: 106.5, rubric: '忠实/通顺' });
  return qs;
}

/** 每个用例一份独立数据库，避免互相污染 */
export function freshDb(tag: string): Cet4Database {
  return createDb(`cet4-test-${tag}-${Math.random().toString(36).slice(2)}`);
}

export async function seedPaper(db: Cet4Database): Promise<void> {
  await putPaperBundle(
    { paper: makePaper(), sections: makeSections(), questions: makeQuestions() },
    db,
  );
}
