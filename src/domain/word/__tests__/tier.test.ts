import { describe, expect, it } from 'vitest';
import {
  byFreqRankAsc,
  CET4_BOUNDARY,
  CORE_BOUNDARY,
  isCore,
  isRankAscendingAndContinuous,
  tierLabel,
  tierOf,
} from '../tier';
import { TIER_CODE, TIER_FROM_CODE, toIndexRow, type Word } from '../types';

function makeWord(freqRank: number, headword = `w${freqRank}`): Word {
  return {
    id: `w_${headword}`,
    headword,
    variants: [],
    senses: [{ pos: 'unknown', zh: '测试' }],
    freqRank,
    freqCount: 1000 - freqRank,
    tier: tierOf(freqRank),
    chunk: 1,
    sentenceCount: 0,
    source: 'test',
    license: 'test',
  };
}

describe('domain/word/tier', () => {
  it('Top2104 边界：rank 2104 属于 core2104，2105 不属于', () => {
    expect(isCore(CORE_BOUNDARY)).toBe(true);
    expect(isCore(CORE_BOUNDARY + 1)).toBe(false);
    expect(tierOf(CORE_BOUNDARY)).toBe('core2104');
    expect(tierOf(CORE_BOUNDARY + 1)).toBe('cet4');
  });

  it('考纲边界内为 cet4，超出为 extended', () => {
    expect(tierOf(CET4_BOUNDARY)).toBe('cet4');
    expect(tierOf(CET4_BOUNDARY + 1)).toBe('extended');
  });

  it('tierLabel 覆盖全部档位', () => {
    expect(tierLabel('core2104')).toBe('高频核心');
    expect(tierLabel('cet4')).toBe('四级考纲');
    expect(tierLabel('extended')).toBe('扩展');
  });

  it('按 freqRank 升序排序（= 词频降序）', () => {
    const rows = [makeWord(3), makeWord(1), makeWord(2)];
    expect([...rows].sort(byFreqRankAsc).map((w) => w.freqRank)).toEqual([1, 2, 3]);
  });

  it('freqRank 连续性与断号检测', () => {
    expect(isRankAscendingAndContinuous([makeWord(1), makeWord(2), makeWord(3)])).toBe(true);
    expect(isRankAscendingAndContinuous([makeWord(1), makeWord(3)])).toBe(false);
    expect(isRankAscendingAndContinuous([])).toBe(true);
  });
});

describe('domain/word/types · 索引压缩', () => {
  it('tier 与压缩码可双向映射', () => {
    expect(TIER_CODE.core2104).toBe(0);
    expect(TIER_CODE.cet4).toBe(1);
    expect(TIER_CODE.extended).toBe(2);
    expect(TIER_FROM_CODE[0]).toBe('core2104');
    expect(TIER_FROM_CODE[1]).toBe('cet4');
    expect(TIER_FROM_CODE[2]).toBe('extended');
  });

  it('toIndexRow 生成列式行', () => {
    const word = makeWord(2104, 'transmit');
    expect(toIndexRow(word)).toEqual({
      id: 'w_transmit',
      w: 'transmit',
      r: 2104,
      t: 0,
      c: 1,
      f: 1000 - 2104,
    });
  });
});
