/**
 * 套卷构建期门禁单测（T-M2-02）。
 *
 * ★ 两条最要紧的用例在最前面：
 *   ① 仓库内**自撰**样卷必须过门禁（否则 UI 层没有可练的卷）；
 *   ② **已产出**的 public/data/papers/** 也必须过门禁 —— 拦住"有人绕过管线手改产物"。
 *
 * 其余用例逐条锁死 error/warn 码，保证门禁不会静默失效。
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExamPaper, ExamQuestion, ExamSection } from '@/domain/exam/types';
import type { PaperBundle } from '@/data/sources/PaperSource';
import {
  collectAudioKeys,
  isDirectRun,
  readBundlesFromDir,
  verifyPaper,
  verifyPapers,
} from '../../scripts/verify-papers';

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORED_DIR = path.join(ROOT, 'scripts', 'data', 'authored', 'papers');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'papers');

function paper(overrides: Partial<ExamPaper> = {}): ExamPaper {
  return {
    id: 'P1',
    year: 2026,
    month: 6,
    setNo: 1,
    level: 'CET4',
    durationMin: 125,
    totalScore: 710,
    provenance: 'derived',
    provenanceLabel: '同源模拟卷',
    derivedFrom: 'CET4 公开考纲与真题语料统计',
    sectionMeta: [
      {
        id: 'P1:W',
        kind: 'writing',
        order: 1,
        partLabel: 'Part I Writing',
        questionFrom: 1,
        questionTo: 1,
        rawScore: 106.5,
      },
      {
        id: 'P1:R',
        kind: 'reading',
        order: 3,
        partLabel: 'Part III Reading',
        questionFrom: 27,
        questionTo: 36,
        rawScore: 248.5,
      },
    ],
    confidence: {
      level: 'medium',
      hasTranscript: false,
      hasAudio: false,
      hasExplanation: true,
      answerCrossChecked: false,
      spotCheckRatio: 1,
      doubtCount: 0,
      note: '内容自撰，不复制任何原文',
    },
    ...overrides,
  };
}

function question(overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    id: `P1:Q${overrides.no ?? 27}`,
    paperId: 'P1',
    sectionId: 'P1:R',
    kind: 'choice',
    no: 27,
    score: 2,
    stem: 'What is the main idea?',
    options: ['A. a', 'B. b', 'C. c', 'D. d'],
    answer: 'B',
    ...overrides,
  };
}

function section(overrides: Partial<ExamSection> = {}): ExamSection {
  return {
    id: 'P1:R-A',
    paperId: 'P1',
    kind: 'reading',
    subPart: 'Passage One',
    order: 3,
    questions: [],
    ...overrides,
  };
}

function bundle(overrides: Partial<PaperBundle> = {}): PaperBundle {
  return {
    paper: paper(),
    sections: [section()],
    questions: [question()],
    ...overrides,
  };
}

/** 只取 error 码，便于断言 */
function codes(issues: ReturnType<typeof verifyPaper>): string[] {
  return issues.filter((i) => i.level === 'error').map((i) => i.code);
}

function warnCodes(issues: ReturnType<typeof verifyPaper>): string[] {
  return issues.filter((i) => i.level === 'warn').map((i) => i.code);
}

describe('★ 仓库内样卷与产物都必须过门禁', () => {
  it('自撰源卷 derived-2026-06-set1 零 error', () => {
    const bundles = readBundlesFromDir(AUTHORED_DIR);
    expect(bundles.length).toBeGreaterThan(0);
    expect(codes(verifyPapers(bundles))).toEqual([]);
  });

  it('★ 已产出的 public/data/papers/** 同样零 error（防手改产物绕过管线）', () => {
    const bundles = readBundlesFromDir(OUT_DIR);
    expect(bundles.length).toBeGreaterThan(0);
    expect(codes(verifyPapers(bundles))).toEqual([]);
  });

  it('index.json 恒为 defaultMissingAudio=true 且 killSwitch 未触发', () => {
    const index = JSON.parse(
      fs.readFileSync(path.join(OUT_DIR, 'index.json'), 'utf8'),
    ) as { defaultMissingAudio: boolean; killSwitch?: { disabled: boolean } };
    expect(index.defaultMissingAudio).toBe(true);
    expect(index.killSwitch?.disabled).toBe(false);
  });
});

describe('铁律 A6 · 音频零入库', () => {
  it('嵌套的 audioTrackId 会被拦下', () => {
    const b = bundle();
    b.paper.sectionMeta[1] = { ...b.paper.sectionMeta[1]!, audioTrackId: 'track-1' };
    expect(codes(verifyPaper(b))).toContain('A6_AUDIO_FIELD');
  });

  it("original 卷 confidence.hasAudio=true → 额外报 A6_HAS_AUDIO", () => {
    const b = bundle({
      paper: paper({
        provenance: 'original',
        confidence: { ...paper().confidence, hasAudio: true },
      }),
    });
    expect(codes(verifyPaper(b))).toContain('A6_HAS_AUDIO');
  });

  it('collectAudioKeys 给可定位路径，且 undefined 不算携带', () => {
    expect(collectAudioKeys({ a: { audioUrl: 'x' }, audioX: undefined })).toEqual(['a.audioUrl']);
  });
});

describe('A7 · 来源与置信度必须显式标注', () => {
  it('非法 provenance → BAD_PROVENANCE', () => {
    const b = bundle({ paper: paper({ provenance: 'scraped' as never }) });
    expect(codes(verifyPaper(b))).toContain('BAD_PROVENANCE');
  });

  it('缺 provenanceLabel → NO_LABEL', () => {
    const b = bundle({ paper: paper({ provenanceLabel: '' }) });
    expect(codes(verifyPaper(b))).toContain('NO_LABEL');
  });

  it('缺 confidence → NO_CONFIDENCE', () => {
    const b = bundle();
    b.paper = { ...b.paper, confidence: undefined } as unknown as ExamPaper;
    expect(codes(verifyPaper(b))).toContain('NO_CONFIDENCE');
  });

  it('derived 缺 derivedFrom → 仅 warn（不阻断）', () => {
    const b = bundle({ paper: paper({ derivedFrom: undefined }) });
    expect(warnCodes(verifyPaper(b))).toContain('NO_DERIVED_FROM');
    expect(codes(verifyPaper(b))).toEqual([]);
  });

  it('自撰字段命中禁用词 → FORBIDDEN_WORD（"全真模考"）', () => {
    const b = bundle({ paper: paper({ provenanceLabel: '全真模考卷' }) });
    expect(codes(verifyPaper(b))).toContain('FORBIDDEN_WORD');
  });
});

describe('sectionMeta 结构校验', () => {
  it('order 重复 → DUP_ORDER', () => {
    const b = bundle();
    b.paper.sectionMeta[1] = { ...b.paper.sectionMeta[1]!, order: 1 };
    expect(codes(verifyPaper(b))).toContain('DUP_ORDER');
  });

  it('题号区间非法（from > to）→ BAD_RANGE', () => {
    const b = bundle();
    b.paper.sectionMeta[1] = {
      ...b.paper.sectionMeta[1]!,
      questionFrom: 40,
      questionTo: 30,
    };
    expect(codes(verifyPaper(b))).toContain('BAD_RANGE');
  });

  it('题号区间重叠 → RANGE_OVERLAP', () => {
    const b = bundle();
    b.paper.sectionMeta[1] = { ...b.paper.sectionMeta[1]!, questionFrom: 1, questionTo: 36 };
    expect(codes(verifyPaper(b))).toContain('RANGE_OVERLAP');
  });

  it('sectionMeta 为空 → NO_SECTIONS', () => {
    const b = bundle({ paper: paper({ sectionMeta: [] }) });
    expect(codes(verifyPaper(b))).toContain('NO_SECTIONS');
  });
});

describe('题目校验', () => {
  it('题号落不到任何区间 → QNO_OUT_OF_RANGE', () => {
    const b = bundle({ questions: [question({ no: 99, id: 'P1:Q99' })] });
    expect(codes(verifyPaper(b))).toContain('QNO_OUT_OF_RANGE');
  });

  it('题号重复 → DUP_QNO', () => {
    const b = bundle({ questions: [question({ no: 27 }), question({ no: 27, id: 'P1:Q27b' })] });
    expect(codes(verifyPaper(b))).toContain('DUP_QNO');
  });

  it('★ 客观题缺 answer → MISSING_ANSWER（否则 grader 悄悄吃掉分母）', () => {
    const b = bundle({ questions: [question({ answer: undefined })] });
    expect(codes(verifyPaper(b))).toContain('MISSING_ANSWER');
  });

  it('主观题（essay / translation）无 answer 不算问题', () => {
    const b = bundle({
      questions: [
        question({ no: 1, id: 'P1:E1', kind: 'essay', answer: undefined, sectionId: 'P1:W' }),
        question({ no: 2, id: 'P1:T1', kind: 'translation', answer: undefined }),
      ],
    });
    b.paper.sectionMeta[0] = { ...b.paper.sectionMeta[0]!, questionFrom: 1, questionTo: 2 };
    expect(codes(verifyPaper(b))).not.toContain('MISSING_ANSWER');
  });

  it('reading 板块零客观题 → warn NO_OBJECTIVE', () => {
    const b = bundle({ questions: [] });
    expect(warnCodes(verifyPaper(b))).toContain('NO_OBJECTIVE');
  });
});

describe('模块副作用', () => {
  it('★ 被 import 时不得执行 CLI（build-papers 依赖此行为）', () => {
    expect(isDirectRun()).toBe(false);
  });
});
