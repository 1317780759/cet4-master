import { describe, expect, it } from 'vitest';
import type { ExamPaper } from '@/domain/exam/types';
import { assertNoAudioFields, collectAudioKeys } from '@/data/sources/BuiltinPaperSource';

/**
 * 铁律 A6 运行时断言单测。
 *
 * ★ 最重要的一条是第一个用例：`provenance='original'` 的卷**必须能加载**。
 *   这里原先是 `assertNotOriginal`，与用户拍板的 `original` 路线（docs/02 §C11）冲突，
 *   若回归成"拒绝 original"，内置卷将一条也加载不出来 —— 该用例即为此而设。
 */

function paper(overrides: Partial<ExamPaper> = {}): ExamPaper {
  return {
    id: 'P1',
    year: 2026,
    month: 6,
    setNo: 1,
    level: 'CET4',
    durationMin: 125,
    totalScore: 710,
    provenance: 'original',
    provenanceLabel: '第三方整理卷',
    sectionMeta: [
      { id: 'P1:W', kind: 'writing', order: 1, partLabel: 'Part I Writing', questionFrom: 1, questionTo: 1, rawScore: 106.5 },
      { id: 'P1:R', kind: 'reading', order: 3, partLabel: 'Part III Reading', questionFrom: 27, questionTo: 56, rawScore: 248.5 },
    ],
    confidence: {
      level: 'medium',
      hasTranscript: false,
      hasAudio: false,
      hasExplanation: true,
      answerCrossChecked: false,
      spotCheckRatio: 0.1,
      doubtCount: 0,
    },
    ...overrides,
  };
}

describe('★ original 路线可加载（回归守卫）', () => {
  it('provenance=original 且无音频字段 → 通过，不得抛错', () => {
    expect(() => assertNoAudioFields(paper())).not.toThrow();
  });

  it('derived / user-imported 同样受音频零入库约束', () => {
    expect(() => assertNoAudioFields(paper({ provenance: 'derived' }))).not.toThrow();
    expect(() => assertNoAudioFields(paper({ provenance: 'user-imported' }))).not.toThrow();
  });
});

describe('assertNoAudioFields · 拦截音频字段', () => {
  it('顶层 audioUrl → 抛错并指出字段名', () => {
    const p = { ...paper(), audioUrl: 'https://example.test/a.mp3' } as unknown as ExamPaper;
    expect(() => assertNoAudioFields(p)).toThrow(/铁律 A6/);
    expect(() => assertNoAudioFields(p)).toThrow(/audioUrl/);
  });

  it('★ 嵌套在 sectionMeta 里的 audioTrackId 也要拦（只看顶层会漏）', () => {
    const p = paper();
    p.sectionMeta[1] = { ...p.sectionMeta[1]!, audioTrackId: 'track-1' };
    expect(() => assertNoAudioFields(p)).toThrow(/audioTrackId/);
  });

  it('数组深处的 audioRange 也要拦', () => {
    const p = paper();
    p.sectionMeta[1] = { ...p.sectionMeta[1]!, audioRange: { startSec: 0, endSec: 30 } } as never;
    expect(() => assertNoAudioFields(p)).toThrow(/audioRange/);
  });

  it('值为 undefined 的 audio 字段不算携带（不随 JSON 序列化）', () => {
    const p = { ...paper(), audioTrackId: undefined } as unknown as ExamPaper;
    expect(() => assertNoAudioFields(p)).not.toThrow();
  });
});

describe('collectAudioKeys · 路径收集', () => {
  it('给出可定位的字段路径', () => {
    const data = { a: { audioTrackId: 'x' }, list: [{ audioUrl: 'y' }] };
    expect(collectAudioKeys(data).sort()).toEqual(['a.audioTrackId', 'list[0].audioUrl']);
  });

  it('无音频字段时返回空数组', () => {
    expect(collectAudioKeys({ a: 1, b: { c: 'text' } })).toEqual([]);
  });
});
