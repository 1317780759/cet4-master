/**
 * ★ 金标准回归测试（20 条人工标注分）—— `scorer` 的调参账本。
 *
 * 纪律：`__tests__/golden.ts` 里的每条 `expected` 都是人工标注的。
 * 一旦本测试失败，说明 `BAND_TABLE` / `KEYWORD_WEIGHT` / `IRREGULAR` / 匹配算法变了，
 * **必须逐条人工复核**新分档是否合理，再决定是否更新标注 —— 禁止直接把输出抄回 fixture。
 */

import { describe, expect, it } from 'vitest';
import { scoreOffline } from '../scorer';
import { GOLDEN_CASES } from './golden';

describe('金标准回归集', () => {
  it('★ 不变量：回归集恰好 20 条，id 唯一', () => {
    expect(GOLDEN_CASES).toHaveLength(20);
    expect(new Set(GOLDEN_CASES.map((c) => c.id)).size).toBe(20);
  });

  it.each([...GOLDEN_CASES])(
    '$id · $note',
    ({ keyPoints, text, expected }) => {
      const result = scoreOffline({ text, keyPoints });
      expect(result.hit).toBe(expected.hit);
      expect(result.total).toBe(expected.total);
      expect(result.ratio).toBeCloseTo(expected.ratio, 3);
      expect(result.band).toBe(expected.band);
    },
  );

  it('★ 不变量：档位分布覆盖 0–4 全部五档（调阈值时若某档消失必须被人工确认）', () => {
    const bands = new Set(GOLDEN_CASES.map((c) => c.expected.band));
    expect([...bands].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('★ 不变量：每条用例的 hit ≤ total，且 total 等于 keyPoints 条数', () => {
    for (const item of GOLDEN_CASES) {
      expect(item.expected.total).toBe(item.keyPoints.length);
      expect(item.expected.hit).toBeLessThanOrEqual(item.expected.total);
      expect(item.expected.ratio).toBeGreaterThanOrEqual(0);
      expect(item.expected.ratio).toBeLessThanOrEqual(1);
    }
  });

  it('★ 不变量：档位与 ratio 的关系必须与 BAND_TABLE 一致（防止标注与实现脱节）', () => {
    for (const item of GOLDEN_CASES) {
      const result = scoreOffline({ text: item.text, keyPoints: item.keyPoints });
      expect(result.band).toBe(item.expected.band);
    }
  });
});
