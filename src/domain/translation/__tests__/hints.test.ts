/**
 * `hints.ts` 单测 —— 分级提示的降级逻辑。
 *
 * ★ 重点验证两条产品约束：
 *   1. 人工提示优先，缺省时用 keyPoints 兜底（保证"给点提示"这个按钮永远有意义）；
 *   2. 最多三级 —— 提示给到第四级就等于把答案摊开了。
 */

import { describe, expect, it } from 'vitest';
import { MAX_HINT_LEVELS, hasHints, hintLevels } from '../hints';
import type { TranslationItem } from '../types';

function makeItem(overrides: Partial<TranslationItem> = {}): TranslationItem {
  return {
    id: 't_000001',
    topic: 'trad-culture',
    difficulty: 2,
    zh: '剪纸是中国最受欢迎的民间艺术之一，已有超过一千五百年的历史。',
    reference: 'Paper-cutting is one of the most popular folk arts in China.',
    keyPoints: [
      { id: 'kp1', head: 'one of the most popular', zh: '最受欢迎的……之一' },
      { id: 'kp2', head: 'folk art', zh: '民间艺术' },
    ],
    source: 'authored',
    ...overrides,
  };
}

describe('hintLevels', () => {
  it('优先返回人工撰写的提示，保持原顺序', () => {
    const item = makeItem({ hints: ['得分点：最受欢迎的……之一', '句型：A is …, with a history of …'] });
    expect(hintLevels(item)).toEqual(['得分点：最受欢迎的……之一', '句型：A is …, with a history of …']);
  });

  it('人工提示缺失时用 keyPoints 合成第 1 级', () => {
    const levels = hintLevels(makeItem());
    expect(levels).toHaveLength(1);
    expect(levels[0]).toContain('one of the most popular');
    expect(levels[0]).toContain('folk art');
  });

  it('hints 为空数组时同样走兜底', () => {
    expect(hintLevels(makeItem({ hints: [] }))).toHaveLength(1);
  });

  it('★ 最多三级：给到第四级等于把答案摊开', () => {
    const item = makeItem({ hints: ['一', '二', '三', '四', '五'] });
    expect(hintLevels(item)).toHaveLength(MAX_HINT_LEVELS);
    expect(hintLevels(item)).not.toContain('四');
  });

  it('过滤空串与纯空白，并 trim', () => {
    const item = makeItem({ hints: ['  一级  ', '', '   ', '二级'] });
    expect(hintLevels(item)).toEqual(['一级', '二级']);
  });

  it('人工提示全为空时仍走 keyPoints 兜底', () => {
    const item = makeItem({ hints: ['', '  '] });
    expect(hintLevels(item)).toHaveLength(1);
    expect(hintLevels(item)[0]).toContain('得分点');
  });

  it('既无 hints 又无 keyPoints → 空数组（UI 应隐藏提示按钮）', () => {
    expect(hintLevels(makeItem({ hints: undefined, keyPoints: [] }))).toEqual([]);
  });

  it('脏数据：hints 不是数组时视为缺失', () => {
    const item = makeItem({ hints: '不是数组' as unknown as string[] });
    expect(hintLevels(item)).toHaveLength(1);
  });

  it('keyPoints 里有空 head 时跳过，不产生空串项', () => {
    const item = makeItem({
      hints: undefined,
      keyPoints: [
        { id: 'kp1', head: '  ', zh: '空' },
        { id: 'kp2', head: 'folk art', zh: '民间艺术' },
      ],
    });
    expect(hintLevels(item)).toEqual(['得分点：folk art']);
  });
});

describe('hasHints', () => {
  it('有可用提示 → true', () => {
    expect(hasHints(makeItem())).toBe(true);
    expect(hasHints(makeItem({ hints: ['一级'] }))).toBe(true);
  });

  it('无任何提示来源 → false（不渲染点了没反应的按钮）', () => {
    expect(hasHints(makeItem({ hints: undefined, keyPoints: [] }))).toBe(false);
  });
});