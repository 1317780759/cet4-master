import { describe, expect, it } from 'vitest';
import {
  coverage,
  isStrictlyAscending,
  newWordCandidates,
  pickNewWords,
  resolveOrder,
  shuffle,
} from '../selector';
import { TIER_CODE, type WordIndexRow } from '../types';

function row(rank: number, tier: 0 | 1 | 2 = 0, id?: string): WordIndexRow {
  return { id: id ?? `w_${rank}`, w: `w${rank}`, r: rank, t: tier, c: 1, f: 1000 - rank };
}

/** 构造 1..n 的索引，前 5 条为 core2104 */
function indexOf(n: number): WordIndexRow[] {
  return Array.from({ length: n }, (_, i) => {
    const rank = i + 1;
    const tier: 0 | 1 | 2 = rank <= 5 ? TIER_CODE.core2104 : rank <= 8 ? TIER_CODE.cet4 : TIER_CODE.extended;
    return row(rank, tier);
  });
}

describe('domain/word/selector', () => {
  it('学习队列严格按 freqRank 升序', () => {
    const picked = pickNewWords(indexOf(20), { limit: 6 });
    expect(picked.map((r) => r.r)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(isStrictlyAscending(picked)).toBe(true);
  });

  it('即使输入乱序，输出也严格升序', () => {
    const shuffled = shuffle(indexOf(20), () => 0.42);
    const picked = pickNewWords(shuffled, { limit: 5 });
    expect(isStrictlyAscending(picked)).toBe(true);
    expect(picked[0].r).toBe(1);
  });

  it('Top2104（高频核心）优先于其他档位', () => {
    const picked = pickNewWords(indexOf(20), { limit: 5 });
    expect(picked.every((r) => r.t === TIER_CODE.core2104)).toBe(true);
    // 第 6 个开始进入 cet4
    const six = pickNewWords(indexOf(20), { limit: 6 });
    expect(six[5].t).toBe(TIER_CODE.cet4);
  });

  it('已学词被排除，不会重复引入', () => {
    const exclude = new Set(['w_1', 'w_2', 'w_3']);
    const picked = pickNewWords(indexOf(20), { limit: 3, exclude });
    expect(picked.map((r) => r.id)).toEqual(['w_4', 'w_5', 'w_6']);
  });

  it('tier 过滤生效', () => {
    const core = pickNewWords(indexOf(20), { limit: 100, tier: 'core2104' });
    expect(core.map((r) => r.r)).toEqual([1, 2, 3, 4, 5]);
    const all = pickNewWords(indexOf(20), { limit: 100, tier: 'all' });
    expect(all).toHaveLength(20);
  });

  it('freqOrdering=false 时使用注入的随机源（结果确定且不重复）', () => {
    const picked = pickNewWords(indexOf(10), { limit: 4, freqOrdering: false, random: () => 0.5 });
    expect(picked).toHaveLength(4);
    const ids = new Set(picked.map((r) => r.id));
    expect(ids.size).toBe(4);
  });

  it('limit=0 返回空，limit 超出候选数时截断', () => {
    expect(pickNewWords(indexOf(5), { limit: 0 })).toEqual([]);
    expect(pickNewWords(indexOf(3), { limit: 10 })).toHaveLength(3);
  });

  it('newWordCandidates 不修改入参', () => {
    const input = indexOf(10);
    const snapshot = input.map((r) => r.r);
    newWordCandidates(input, {});
    expect(input.map((r) => r.r)).toEqual(snapshot);
  });

  it('coverage 计算 Top2104 覆盖率（G1）', () => {
    const report = coverage([1, 2, 3, 2104, 2105, 3000], 2104);
    expect(report.coreLearned).toBe(4);
    expect(report.coreTotal).toBe(2104);
    expect(report.learned).toBe(6);
    expect(report.ratio).toBeCloseTo(4 / 2104, 6);
  });

  it('coverage 空输入安全', () => {
    const report = coverage([], 2104);
    expect(report.coreLearned).toBe(0);
    expect(report.ratio).toBe(0);
  });

  // —— 需求 3：出词顺序（v2 的 studyOrder 四档）——

  describe('resolveOrder', () => {
    it('order 优先：freq 走词频，其余三档的新词部分退化为随机', () => {
      expect(resolveOrder({ order: 'freq' })).toBe('freq');
      expect(resolveOrder({ order: 'random' })).toBe('random');
      expect(resolveOrder({ order: 'weak' })).toBe('random');
      expect(resolveOrder({ order: 'wrong' })).toBe('random');
    });

    it('退回 v1 的 freqOrdering，最终兜底词频（老调用方行为不变）', () => {
      expect(resolveOrder({ freqOrdering: false })).toBe('random');
      expect(resolveOrder({ freqOrdering: true })).toBe('freq');
      expect(resolveOrder({})).toBe('freq');
    });
  });

  it("order='random' 不会每次都取前 N 个（用户要的「不要从头开始」）", () => {
    // random() 恒返回 0 → Fisher–Yates 每轮都把末尾换到队首，结果必然不是 [1,2,3,4]
    const picked = pickNewWords(indexOf(20), { limit: 4, order: 'random', random: () => 0 });
    expect(picked).toHaveLength(4);
    expect(picked.map((r) => r.r)).not.toEqual([1, 2, 3, 4]);
    // 同一随机源 → 结果确定（可复现）
    const again = pickNewWords(indexOf(20), { limit: 4, order: 'random', random: () => 0 });
    expect(again.map((r) => r.id)).toEqual(picked.map((r) => r.id));
  });

  it("order='freq' 与旧 freqOrdering:true 等价（严格升序）", () => {
    const a = pickNewWords(indexOf(20), { limit: 6, order: 'freq' });
    const b = pickNewWords(indexOf(20), { limit: 6, freqOrdering: true });
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(isStrictlyAscending(a)).toBe(true);
  });
});
