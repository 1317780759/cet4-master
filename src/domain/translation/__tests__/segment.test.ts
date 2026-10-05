/**
 * `segment.ts` 单测 —— 中文段落拆句（构建期与运行期共用同一实现）。
 *
 * 铁律 A8：除断言绝对值外，**必须断言不变量**
 *   （`text.slice(start, end) === text`、区间不重叠且升序、拼回可覆盖原文非空白字符）。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_LEN, MIN_PART_LEN, segmentChinese } from '../segment';
import type { Segment } from '../segment';

/** 非空白字符数（与实现一致，用于长度断言） */
function charCount(text: string): number {
  return Array.from(text).filter((ch) => !/\s/.test(ch)).length;
}

/** ★ 不变量：每个 Segment 的区间必须能原样还原出 text */
function expectOffsetsConsistent(text: string, segments: Segment[]): void {
  for (const segment of segments) {
    expect(text.slice(segment.start, segment.end)).toBe(segment.text);
  }
}

/** ★ 不变量：区间升序、不重叠、index 连续 */
function expectOrdered(segments: Segment[]): void {
  segments.forEach((segment, i) => {
    expect(segment.index).toBe(i);
    if (i > 0) {
      expect(segment.start).toBeGreaterThanOrEqual((segments[i - 1] as Segment).end);
    }
    expect(segment.end).toBeGreaterThan(segment.start);
  });
}

describe('segmentChinese · 基础', () => {
  it('空串返回空数组', () => {
    expect(segmentChinese('')).toEqual([]);
    expect(segmentChinese('   \n  ')).toEqual([]);
  });

  it('无标点时整段作为一句', () => {
    const text = '春节是中国最重要的传统节日';
    const segments = segmentChinese(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe(text);
    expect(segments[0]?.start).toBe(0);
    expect(segments[0]?.end).toBe(text.length);
  });

  it('按句末标点切分，且标点跟随前句', () => {
    const text = '春节是中国最重要的传统节日。人们会回家团圆，一起吃年夜饭。';
    const segments = segmentChinese(text);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.text.endsWith('。')).toBe(true);
    expect(segments[1]?.text.endsWith('。')).toBe(true);
    expect(segments[0]?.text).toBe('春节是中国最重要的传统节日。');
    expect(segments[1]?.text).toBe('人们会回家团圆，一起吃年夜饭。');
    expectOffsetsConsistent(text, segments);
    expectOrdered(segments);
  });

  it('半角 ! ? ; 同样作为句末标点', () => {
    const text = '这是第一句!这是第二句?这是第三句;这是第四句。';
    expect(segmentChinese(text)).toHaveLength(4);
  });

  it('右括号紧跟句末标点时并入前句', () => {
    const text = '（“春节要回家”。）大家一起吃饭。';
    const segments = segmentChinese(text);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toBe('（“春节要回家”。）');
    expect(segments[1]?.text).toBe('大家一起吃饭。');
  });

  it('★ 不变量：所有句段拼回后覆盖原文全部非空白字符', () => {
    const text = '第一句在这里。第二句在这里！第三句在这里？';
    const segments = segmentChinese(text);
    const joined = segments.map((s) => s.text).join('');
    expect(joined).toBe(text);
    expect(charCount(joined)).toBe(charCount(text));
  });
});

describe('segmentChinese · cuts 人工切点', () => {
  it('cuts 无条件切开，优先级高于标点', () => {
    const text = '这是第一句这是第二句。';
    const segments = segmentChinese(text, { cuts: [5] });
    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toBe('这是第一句');
    expect(segments[1]?.text).toBe('这是第二句。');
  });

  it('多个 cuts 与标点切点共存且去重', () => {
    const text = '一二三四五六七八九十。甲乙丙丁。';
    const segments = segmentChinese(text, { cuts: [3, 3, 6] });
    expect(segments.map((s) => s.text)).toEqual(['一二三', '四五六', '七八九十。', '甲乙丙丁。']);
    expectOrdered(segments);
  });

  it('越界 / 非整数 cuts 被忽略', () => {
    const text = '一二三四。五六七八。';
    const segments = segmentChinese(text, { cuts: [-1, 0, 1.5, 999, Number.NaN] });
    expect(segments).toHaveLength(2);
  });
});

describe('segmentChinese · maxLen 二切', () => {
  it('★ 长句在「，」处均衡二切，切后每片 ≥ MIN_PART_LEN', () => {
    const parts = Array.from({ length: 10 }, (_, i) => `第${i + 1}部分内容`);
    const text = `${parts.join('，')}。`;
    // 10 片（末片「第10部分内容」多一位）+ 9 个逗号 + 1 个句号 → 必然超过默认 maxLen
    expect(charCount(text)).toBeGreaterThan(DEFAULT_MAX_LEN);

    const segments = segmentChinese(text, { maxLen: 60 });
    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toBe(`${parts.slice(0, 5).join('，')}，`);
    expect(segments[1]?.text).toBe(`${parts.slice(5).join('，')}。`);
    for (const segment of segments) {
      expect(charCount(segment.text)).toBeGreaterThanOrEqual(MIN_PART_LEN);
      expect(charCount(segment.text)).toBeLessThanOrEqual(60);
    }
    expectOffsetsConsistent(text, segments);
  });

  it('maxLen = 0 表示不二切', () => {
    const parts = Array.from({ length: 10 }, (_, i) => `第${i + 1}部分内容`);
    const text = `${parts.join('，')}。`;
    expect(segmentChinese(text, { maxLen: 0 })).toHaveLength(1);
  });

  it('默认 maxLen 为 DEFAULT_MAX_LEN', () => {
    expect(DEFAULT_MAX_LEN).toBe(60);
    const parts = Array.from({ length: 10 }, (_, i) => `第${i + 1}部分内容`);
    const text = `${parts.join('，')}。`;
    expect(segmentChinese(text)).toHaveLength(2);
  });

  it('★ 切后碎片不足 MIN_PART_LEN 时宁可不切', () => {
    const text = `一二三四五，${'测'.repeat(70)}。`;
    expect(charCount(text)).toBeGreaterThan(60);
    const segments = segmentChinese(text, { maxLen: 60 });
    // 唯一的逗号在第 5 位，切后左片只有 6 字 < 12 → 不切
    expect(segments).toHaveLength(1);
  });

  it('无「，」「、」时即使超长也不切', () => {
    const text = `${'长'.repeat(100)}。`;
    expect(segmentChinese(text, { maxLen: 60 })).toHaveLength(1);
  });

  it('「、」同样可作为软切点', () => {
    const parts = Array.from({ length: 10 }, (_, i) => `第${i + 1}项`);
    const text = `${parts.join('、')}。`;
    // 3~4 字 × 10 + 9 个顿号 + 1 个句号 ≈ 41 字，小于默认 maxLen → 不二切
    expect(charCount(text)).toBeLessThanOrEqual(DEFAULT_MAX_LEN);
    expect(segmentChinese(text)).toHaveLength(1);
    expect(segmentChinese(text, { maxLen: 20 })).toHaveLength(2);
  });
});

describe('segmentChinese · 实际段落', () => {
  it('CET-4 风格的中文题干拆句结果稳定可复现', () => {
    const text =
      '随着经济的快速发展，城市化进程不断加快，越来越多的人选择到大城市工作和生活。与此同时，交通拥堵与环境污染问题也日益突出。专家表示，只有统筹规划才能解决这个问题。';
    const segments = segmentChinese(text);
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.text)).toEqual([
      '随着经济的快速发展，城市化进程不断加快，越来越多的人选择到大城市工作和生活。',
      '与此同时，交通拥堵与环境污染问题也日益突出。',
      '专家表示，只有统筹规划才能解决这个问题。',
    ]);
    expectOffsetsConsistent(text, segments);
    expectOrdered(segments);
  });

  it('多次调用结果完全一致（纯函数）', () => {
    const text = '第一句。第二句！第三句？';
    expect(segmentChinese(text)).toEqual(segmentChinese(text));
  });
});
