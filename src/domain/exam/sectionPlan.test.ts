import { describe, expect, it } from 'vitest';
import type { ExamPaper, ExamSectionMeta } from './types';
import {
  buildSectionPlan,
  DEFAULT_DISABLED_SECTIONS,
  findSlot,
  type SectionPlan,
} from './sectionPlan';

/**
 * buildSectionPlan 单测 —— 断言**不变量与关系**，不断言魔法数字（铁律 A8）。
 *
 * 本文件最重要的用例是「可恢复性往返」（docs/04 §2.6）：
 * 它把「听力停用但保留预留位」从一句口号变成可执行断言。
 * **若这条用例变红，说明有人把三板块写死进了代码。**
 */

/** 写作 30 / 听力 25 / 阅读 40 / 翻译 30（分钟） */
const SEC = { writing: 30 * 60, listening: 25 * 60, reading: 40 * 60, translation: 30 * 60 } as const;

/** 构造一份含 4 个板块的测试卷（含 listening）——可恢复性往返的被测对象 */
function makePaperWith4Sections(): ExamPaper {
  const meta: ExamSectionMeta[] = [
    { id: 'P:W', kind: 'writing', order: 1, partLabel: 'Part I Writing', questionFrom: 1, questionTo: 1, durationHintSec: SEC.writing, rawScore: 106.5 },
    { id: 'P:L', kind: 'listening', order: 2, partLabel: 'Part II Listening', questionFrom: 2, questionTo: 26, durationHintSec: SEC.listening, rawScore: 248.5, audioTrackId: 'track-1' },
    { id: 'P:R', kind: 'reading', order: 3, partLabel: 'Part III Reading', questionFrom: 27, questionTo: 56, durationHintSec: SEC.reading, rawScore: 248.5 },
    { id: 'P:T', kind: 'translation', order: 4, partLabel: 'Part IV Translation', questionFrom: 57, questionTo: 57, durationHintSec: SEC.translation, rawScore: 106.5 },
  ];
  return {
    id: 'TEST-PAPER',
    year: 2026,
    month: 6,
    setNo: 1,
    level: 'CET4',
    durationMin: 125,
    totalScore: 710,
    sectionMeta: meta,
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

const sumDurations = (plan: SectionPlan) => plan.slots.reduce((s, x) => s + x.durationSec, 0);

describe('buildSectionPlan · 不变量', () => {
  it('slots 按 meta.order 严格升序', () => {
    const plan = buildSectionPlan(makePaperWith4Sections());
    expect(plan.slots.map((s) => s.meta.kind)).toEqual(['writing', 'reading', 'translation']);
    expect(plan.slots.every((s, i, a) => i === 0 || a[i - 1]!.meta.order < s.meta.order)).toBe(true);
  });

  it('总时长自洽：① 路径下 totalSec === Σ slot.durationSec', () => {
    const plan = buildSectionPlan(makePaperWith4Sections());
    expect(plan.durationSource).toBe('sum');
    expect(plan.totalSec).toBe(sumDurations(plan));
  });

  it('questionCount 与题号区间一致，且区间合法', () => {
    for (const plan of [
      buildSectionPlan(makePaperWith4Sections()),
      buildSectionPlan(makePaperWith4Sections(), []),
    ]) {
      expect(plan.slots.every((s) => s.questionFrom <= s.questionTo)).toBe(true);
      expect(plan.slots.every((s) => s.questionCount === s.questionTo - s.questionFrom + 1)).toBe(true);
    }
  });

  it('不修改入参（sort 不得原地污染 paper.sectionMeta）', () => {
    const paper = makePaperWith4Sections();
    const before = paper.sectionMeta.map((m) => m.kind).join(',');
    buildSectionPlan(paper);
    buildSectionPlan(paper, []);
    expect(paper.sectionMeta.map((m) => m.kind).join(',')).toBe(before);
  });

  it('默认停用清单为听力（唯一知情处）', () => {
    expect([...DEFAULT_DISABLED_SECTIONS]).toEqual(['listening']);
  });
});

describe('★ 可恢复性往返（docs/04 §2.6）—— 保留预留位的可执行定义', () => {
  it('移除听力停用后板块数与总时长自动恢复，且无需改任何业务代码', () => {
    const paper = makePaperWith4Sections();
    const spec = paper.durationMin * 60;

    const current = buildSectionPlan(paper, ['listening']);
    const restored = buildSectionPlan(paper, []);

    // 本期形态：3 板块，不含听力
    expect(current.slots).toHaveLength(3);
    expect(current.slots.map((s) => s.meta.kind)).toEqual(['writing', 'reading', 'translation']);
    expect(current.disabledKinds).toEqual(['listening']);

    // 恢复形态：**零代码改动**，仅把 disabled 传空 → 4 板块且总时长回到规格
    expect(restored.slots).toHaveLength(4);
    expect(restored.slots.map((s) => s.meta.kind)).toEqual(['writing', 'listening', 'reading', 'translation']);
    expect(restored.disabledKinds).toEqual([]);
    expect(restored.totalSec).toBe(spec);

    // 差值关系：本期时长 = 规格 − 停用板块时长（不写死 6000 / 7500）
    expect(current.totalSec).toBe(spec - SEC.listening);
    expect(restored.totalSec - current.totalSec).toBe(SEC.listening);
  });

  it('总时长永不超过考试规格', () => {
    const paper = makePaperWith4Sections();
    for (const plan of [buildSectionPlan(paper), buildSectionPlan(paper, [])]) {
      expect(plan.totalSec).toBeLessThanOrEqual(plan.specSec);
    }
  });
});

describe('buildSectionPlan · 时长兜底（docs/04 §2.5 ②③）', () => {
  it('② 启用板块缺建议用时，但停用板块齐全 → 规格时长减停用板块', () => {
    const paper = makePaperWith4Sections();
    // 抹掉写作的建议用时，且保留听力为停用板块（其 durationHintSec 齐全）
    paper.sectionMeta = paper.sectionMeta.map((m) =>
      m.kind === 'writing' ? { ...m, durationHintSec: undefined } : m,
    );
    const plan = buildSectionPlan(paper);
    expect(plan.durationSource).toBe('spec-minus-disabled');
    expect(plan.totalSec).toBe(plan.specSec - SEC.listening);
  });

  it('③ 两条都不可用 → 退回规格时长', () => {
    const paper = makePaperWith4Sections();
    paper.sectionMeta = paper.sectionMeta.map((m) => ({ ...m, durationHintSec: undefined }));
    // 停用板块也被抹掉 durationHintSec ⇒ ② 不可用
    const plan = buildSectionPlan(paper);
    expect(plan.durationSource).toBe('spec');
    expect(plan.totalSec).toBe(plan.specSec);
  });
});

describe('findSlot', () => {
  it('启用板块返回槽位，停用板块返回 null', () => {
    const plan = buildSectionPlan(makePaperWith4Sections());
    expect(findSlot(plan, 'reading')?.meta.partLabel).toBe('Part III Reading');
    expect(findSlot(plan, 'listening')).toBeNull();
  });
});
