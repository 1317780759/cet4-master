/**
 * `parse.ts` 单测 —— 三级容错 + schema 校验 + "宁可 null 也不给假分"。
 *
 * 铁律 A8：除断言绝对值外，必须断言**不变量**
 *   （解析成功 ⟹ score 一定落在 0..15、corrections 一定 ≤ 5 条且 type 全在白名单内）。
 */

import { describe, expect, it } from 'vitest';
import {
  CORRECTION_TYPES,
  MAX_CORRECTIONS,
  bandFromScore,
  parseLlmReview,
} from '../parse';
import type { LlmCorrection } from '../parse';

/** 造一条合法纠错 */
function correction(
  type: string,
  overrides: Partial<Record<'original' | 'suggested' | 'note', unknown>> = {},
): Record<string, unknown> {
  return {
    original: 'He go to school',
    suggested: 'He goes to school',
    type,
    note: '主谓不一致',
    ...overrides,
  };
}

/** 造一份合法 JSON 文本 */
function review(payload: Record<string, unknown>): string {
  return JSON.stringify({ score: 11, band: 3, ...payload });
}

describe('parseLlmReview · 三级容错', () => {
  it('① 裸 JSON 直接解析', () => {
    const result = parseLlmReview(review({ corrections: [correction('grammar')] }));
    expect(result).not.toBeNull();
    expect(result?.score).toBe(11);
    expect(result?.band).toBe(3);
    expect(result?.corrections).toHaveLength(1);
  });

  it('② 带 ```json 围栏：先剥围栏再解析', () => {
    const text = ['好的，这是批改结果：', '```json', review({ corrections: [] }), '```', ''].join('\n');
    const result = parseLlmReview(text);
    expect(result?.score).toBe(11);
    expect(result?.corrections).toEqual([]);
  });

  it('② 围栏大小写与无语言标记的变体同样能剥', () => {
    const text = `\`\`\`\n${review({ score: 9 })}\n\`\`\``;
    expect(parseLlmReview(text)?.score).toBe(9);
  });

  it('③ 前后有啰嗦文本：截取第一个 { 到最后一个 }', () => {
    const text = `好的！\n${review({ score: 13, band: 3 })}\n希望对你有帮助~`;
    const result = parseLlmReview(text);
    expect(result?.score).toBe(13);
    expect(result?.band).toBe(3);
  });

  it('三级全败（纯自然语言）→ null，绝不返回半成品', () => {
    expect(parseLlmReview('抱歉，我无法完成这次批改。')).toBeNull();
    expect(parseLlmReview('')).toBeNull();
    expect(parseLlmReview('   ')).toBeNull();
    expect(parseLlmReview('{ score: 11 }')).toBeNull();
  });
});

describe('parseLlmReview · score 校验', () => {
  it('★ score 越界（99）→ null', () => {
    expect(parseLlmReview(review({ score: 99 }))).toBeNull();
  });

  it('★ score 负数 → null', () => {
    expect(parseLlmReview(review({ score: -1 }))).toBeNull();
  });

  it('★ score 非数字（字符串 / null / 缺失）→ null', () => {
    expect(parseLlmReview(review({ score: '11' }))).toBeNull();
    expect(parseLlmReview(review({ score: null }))).toBeNull();
    expect(parseLlmReview(JSON.stringify({ band: 3 }))).toBeNull();
  });

  it('score 边界 0 与 15 均接受', () => {
    expect(parseLlmReview(review({ score: 0, band: 0 }))?.score).toBe(0);
    expect(parseLlmReview(review({ score: 15, band: 4 }))?.score).toBe(15);
  });

  it('score 小数按四舍五入收敛到整数', () => {
    expect(parseLlmReview(review({ score: 11.4 }))?.score).toBe(11);
    expect(parseLlmReview(review({ score: 11.6 }))?.score).toBe(12);
  });
});

describe('parseLlmReview · band 校验与推导', () => {
  it('band 缺失 → 由 score 推导', () => {
    expect(parseLlmReview(JSON.stringify({ score: 15 }))?.band).toBe(4);
    expect(parseLlmReview(JSON.stringify({ score: 11 }))?.band).toBe(3);
    expect(parseLlmReview(JSON.stringify({ score: 8 }))?.band).toBe(2);
    expect(parseLlmReview(JSON.stringify({ score: 5 }))?.band).toBe(1);
    expect(parseLlmReview(JSON.stringify({ score: 4 }))?.band).toBe(0);
  });

  it('band 越界（5 / -1）→ null', () => {
    expect(parseLlmReview(review({ band: 5 }))).toBeNull();
    expect(parseLlmReview(review({ band: -1 }))).toBeNull();
  });

  it('band 非整数或非数字 → null', () => {
    expect(parseLlmReview(review({ band: 2.5 }))).toBeNull();
    expect(parseLlmReview(review({ band: '3' }))).toBeNull();
  });

  it('bandFromScore 与 system prompt 六档表一致', () => {
    expect(bandFromScore(15)).toBe(4);
    expect(bandFromScore(14)).toBe(4);
    expect(bandFromScore(13)).toBe(3);
    expect(bandFromScore(11)).toBe(3);
    expect(bandFromScore(10)).toBe(2);
    expect(bandFromScore(8)).toBe(2);
    expect(bandFromScore(7)).toBe(1);
    expect(bandFromScore(5)).toBe(1);
    expect(bandFromScore(4)).toBe(0);
    expect(bandFromScore(0)).toBe(0);
  });
});

describe('parseLlmReview · corrections 清洗', () => {
  it('★ type 不在七种白名单内 → 丢弃该条，其余保留', () => {
    const text = review({ corrections: [correction('grammar'), correction('style'), correction('spelling')] });
    const result = parseLlmReview(text);
    expect(result).not.toBeNull();
    expect(result?.corrections).toHaveLength(2);
    expect(result?.corrections.map((c) => c.type)).toEqual(['grammar', 'spelling']);
  });

  it('★ 超过 5 条 → 截断为 5 条（保留前 5 条，即按严重程度排序的前 5）', () => {
    const many = Array.from({ length: 8 }, (_, i) => correction('grammar', { original: `o${i}` }));
    const result = parseLlmReview(review({ corrections: many }));
    expect(result?.corrections).toHaveLength(MAX_CORRECTIONS);
    expect(result?.corrections.map((c) => c.original)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);
  });

  it('字段不全（缺 original / suggested）→ 丢弃该条', () => {
    const text = review({
      corrections: [
        { type: 'grammar', suggested: 'x', note: 'n' },
        { type: 'grammar', original: 'y', note: 'n' },
        { type: 'grammar', original: 'z', suggested: 'w' },
      ],
    });
    const result = parseLlmReview(text);
    expect(result?.corrections).toHaveLength(1);
    expect(result?.corrections[0]).toEqual({
      original: 'z',
      suggested: 'w',
      type: 'grammar',
      note: '',
    });
  });

  it('corrections 缺失 / 不是数组 → 空数组', () => {
    expect(parseLlmReview(review({ corrections: undefined }))?.corrections).toEqual([]);
    expect(parseLlmReview(review({ corrections: 'nope' }))?.corrections).toEqual([]);
  });

  it('★ 不变量：任何解析成功的 corrections，type 恒在白名单内且条数 ≤ MAX_CORRECTIONS', () => {
    const text = review({
      corrections: [
        ...Array.from({ length: 9 }, () => correction('grammar')),
        correction('unknown-type'),
        correction('punctuation'),
        'not-an-object',
        null,
      ],
    });
    const result = parseLlmReview(text);
    expect(result).not.toBeNull();
    const corrections = (result?.corrections ?? []) as LlmCorrection[];
    expect(corrections.length).toBeLessThanOrEqual(MAX_CORRECTIONS);
    for (const item of corrections) {
      expect(CORRECTION_TYPES).toContain(item.type);
      expect(typeof item.original).toBe('string');
      expect(typeof item.suggested).toBe('string');
      expect(typeof item.note).toBe('string');
    }
  });
});

describe('parseLlmReview · highlights / advice 兜底', () => {
  it('缺失 → 空数组 / 空串', () => {
    const result = parseLlmReview(review({ highlights: undefined, advice: undefined }));
    expect(result?.highlights).toEqual([]);
    expect(result?.advice).toBe('');
  });

  it('highlights 含非字符串元素时被剔除', () => {
    const result = parseLlmReview(review({ highlights: ['用词贴切', 42, null, '句式多样'] }));
    expect(result?.highlights).toEqual(['用词贴切', '句式多样']);
  });

  it('advice 为数组（文档 schema 的示例形态）→ 拼接为字符串', () => {
    const result = parseLlmReview(review({ advice: ['注意可数名词复数', '检查时态'] }));
    expect(result?.advice).toBe('注意可数名词复数\n检查时态');
  });
});

describe('parseLlmReview · 纯函数契约', () => {
  it('同输入恒等输出，可重复调用', () => {
    const text = review({ corrections: [correction('grammar')] });
    expect(parseLlmReview(text)).toEqual(parseLlmReview(text));
  });

  it('顶层不是对象（数组 / 数字 / null）→ null', () => {
    expect(parseLlmReview('[1,2,3]')).toBeNull();
    expect(parseLlmReview('123')).toBeNull();
    expect(parseLlmReview('null')).toBeNull();
  });
});
