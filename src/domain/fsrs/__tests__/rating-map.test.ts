import { describe, expect, it } from 'vitest';
import { isCorrectAnswer, isWrongAnswer, resolveRating } from '../rating-map';
import { HESITATION_MS, RATING_MAP } from '../types';

describe('domain/fsrs/rating-map', () => {
  it('RATING_MAP 与方案 3.3 完全一致', () => {
    expect(RATING_MAP).toEqual({
      'known-clean': 4,
      'known-peek': 3,
      'fuzzy-clean': 3,
      'fuzzy-peek': 2,
      'unknown-clean': 1,
      'unknown-peek': 1,
    });
  });

  it('未被偷看时按自评直接映射', () => {
    expect(resolveRating({ self: 'known', peeked: false, elapsedMs: 1000 })).toBe(4);
    expect(resolveRating({ self: 'fuzzy', peeked: false, elapsedMs: 1000 })).toBe(3);
    expect(resolveRating({ self: 'unknown', peeked: false, elapsedMs: 1000 })).toBe(1);
  });

  it('偷看扣分（peekPenalty 默认开）', () => {
    expect(resolveRating({ self: 'known', peeked: true, elapsedMs: 1000 })).toBe(3);
    expect(resolveRating({ self: 'fuzzy', peeked: true, elapsedMs: 1000 })).toBe(2);
    expect(resolveRating({ self: 'unknown', peeked: true, elapsedMs: 1000 })).toBe(1);
  });

  it('peekPenalty=false 时忽略偷看', () => {
    expect(resolveRating({ self: 'known', peeked: true, elapsedMs: 1000 }, { peekPenalty: false })).toBe(4);
    expect(resolveRating({ self: 'fuzzy', peeked: true, elapsedMs: 1000 }, { peekPenalty: false })).toBe(3);
  });

  it('犹豫降级：自评「认识」但耗时 > 8 秒 → 降到 Good(3)', () => {
    expect(resolveRating({ self: 'known', peeked: false, elapsedMs: HESITATION_MS })).toBe(4);
    expect(resolveRating({ self: 'known', peeked: false, elapsedMs: HESITATION_MS + 1 })).toBe(3);
    // 自定义阈值
    expect(
      resolveRating({ self: 'known', peeked: false, elapsedMs: 3000 }, { hesitationMs: 2000 }),
    ).toBe(3);
  });

  it('犹豫降级不会把 unknown 抬高，也不会把已有 Good 再降', () => {
    expect(resolveRating({ self: 'unknown', peeked: false, elapsedMs: 99_999 })).toBe(1);
    expect(resolveRating({ self: 'fuzzy', peeked: false, elapsedMs: 99_999 })).toBe(3);
  });

  it('错/对判定：只有 Again 算错，>=Good 算对', () => {
    expect(isWrongAnswer(1)).toBe(true);
    expect(isWrongAnswer(2)).toBe(false);
    expect(isCorrectAnswer(3)).toBe(true);
    expect(isCorrectAnswer(4)).toBe(true);
    expect(isCorrectAnswer(1)).toBe(false);
  });
});
