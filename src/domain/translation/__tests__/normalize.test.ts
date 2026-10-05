/**
 * `normalize.ts` 单测 —— 分词 / 归一化 / 词形还原。
 *
 * 铁律 A8：除断言绝对值外，**必须断言不变量**（原形恒在、集合恒去重、偏移恒可还原原文）。
 */

import { describe, expect, it } from 'vitest';
import { IRREGULAR, candidateSetOf, normalizeToken, splitContraction, tokenizeEn } from '../normalize';

/** 取出 token 在原文中的片段，用于校验偏移是否可还原 */
function surfaceOf(text: string, index: number): string {
  const token = tokenizeEn(text)[index];
  expect(token).toBeDefined();
  return text.slice((token as { start: number }).start, (token as { end: number }).end);
}

describe('tokenizeEn', () => {
  it('空串与非字符串输入返回空数组', () => {
    expect(tokenizeEn('')).toEqual([]);
    expect(tokenizeEn('   \n\t  ')).toEqual([]);
  });

  it('基本分词并保留原文偏移（偏移必须能还原出原文片段）', () => {
    const text = 'With the development of economy';
    const tokens = tokenizeEn(text);
    expect(tokens.map((t) => t.text)).toEqual(['with', 'the', 'development', 'of', 'economy']);
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual([
      'With',
      'the',
      'development',
      'of',
      'economy',
    ]);
  });

  it('大小写不敏感：全大写输入归一化为小写', () => {
    expect(tokenizeEn('WITH THE RAPID DEVELOPMENT').map((t) => t.text)).toEqual([
      'with',
      'the',
      'rapid',
      'development',
    ]);
  });

  it('多余空格与换行不影响分词', () => {
    const tokens = tokenizeEn('WITH   THE\n\nRAPID\tDEVELOPMENT');
    expect(tokens.map((t) => t.text)).toEqual(['with', 'the', 'rapid', 'development']);
  });

  it('连字符拆成两个词', () => {
    expect(tokenizeEn('well-known').map((t) => t.text)).toEqual(['well', 'known']);
  });

  it('中文标点混排时标点只作分隔符，不产生 token', () => {
    const text = 'More and more people，because it is convenient。';
    const tokens = tokenizeEn(text);
    expect(tokens.map((t) => t.text)).toEqual([
      'more',
      'and',
      'more',
      'people',
      'because',
      'it',
      'is',
      'convenient',
    ]);
  });

  it('撇号收缩展开成多个 Token，且共享同一原文区间', () => {
    const text = "It isn't good";
    const tokens = tokenizeEn(text);
    expect(tokens.map((t) => t.text)).toEqual(['it', 'is', 'not', 'good']);
    const not = tokens[2];
    expect(text.slice(not?.start, not?.end)).toBe("isn't");
  });

  it('弯撇号（U+2019）与直撇号等价', () => {
    expect(tokenizeEn('don’t').map((t) => t.text)).toEqual(['do', 'not']);
  });

  it('撇号不在词中时（students\'）不会产生空 token', () => {
    expect(tokenizeEn("students' books").map((t) => t.text)).toEqual(['students', 'books']);
  });

  it('数字与全角字符也能被切出且偏移正确', () => {
    const text = 'In 2024, more than 60% of families joined.';
    expect(surfaceOf(text, 1)).toBe('2024');
    expect(surfaceOf(text, 6)).toBe('families');
  });
});

describe('splitContraction', () => {
  it('只展开确定的否定收缩', () => {
    expect(splitContraction("don't")).toEqual(['do', 'not']);
    expect(splitContraction("can't")).toEqual(['can', 'not']);
    expect(splitContraction("won't")).toEqual(['will', 'not']);
    expect(splitContraction('cannot')).toEqual(['can', 'not']);
  });

  it("'s / 've 一律不动（最小惊讶原则）", () => {
    expect(splitContraction("it's")).toEqual(["it's"]);
    expect(splitContraction("they've")).toEqual(["they've"]);
    expect(splitContraction("we're")).toEqual(["we're"]);
  });

  it('未知 Xn\'t 兜底拆成 X + not', () => {
    expect(splitContraction("needn't")).toEqual(['need', 'not']);
    expect(splitContraction("daren't")).toEqual(['dare', 'not']);
  });

  it('非收缩词原样返回', () => {
    expect(splitContraction('development')).toEqual(['development']);
  });
});

describe('normalizeToken', () => {
  it('空输入返回空集合', () => {
    expect(normalizeToken('')).toEqual([]);
    expect(normalizeToken("'")).toEqual([]);
  });

  it('★ 不变量：候选集合永远包含原形，且不含重复项', () => {
    for (const raw of ['Studies', 'books', 'running', 'children', 'went', 'boxes', 'studied']) {
      const keys = normalizeToken(raw);
      expect(keys[0]).toBe(raw.toLowerCase());
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('-ies → y：studies → {studies, study, studie}', () => {
    const keys = normalizeToken('studies');
    expect(keys).toContain('studies');
    expect(keys).toContain('study');
    expect(keys).toContain('studie');
  });

  it('-ed：studied → study / studie', () => {
    const keys = normalizeToken('studied');
    expect(keys).toContain('study');
    expect(keys).toContain('studie');
  });

  it('-s：books → book', () => {
    expect(normalizeToken('books')).toContain('book');
  });

  it('-es：boxes → box', () => {
    expect(normalizeToken('boxes')).toContain('box');
    expect(normalizeToken('dishes')).toContain('dish');
  });

  it('-ing：making → make', () => {
    expect(normalizeToken('making')).toContain('make');
  });

  it('★ 过度还原防线：running → run，且绝不得出 rune', () => {
    const keys = normalizeToken('running');
    expect(keys).toContain('run');
    expect(keys).toContain('runn');
    expect(keys).not.toContain('rune');
  });

  it('短词不做后缀还原，避免 thing → the 之类的噪声', () => {
    expect(normalizeToken('thing')).not.toContain('the');
    expect(normalizeToken('as')).toEqual(['as']);
    // 词干长度不足 2 时（wing → w）直接放弃还原
    expect(normalizeToken('wing')).toEqual(['wing']);
  });

  it('双写还原：stopped → stop', () => {
    expect(normalizeToken('stopped')).toContain('stop');
  });

  it('不规则表命中：children → child，went → go', () => {
    expect(normalizeToken('children')).toContain('child');
    expect(normalizeToken('went')).toContain('go');
  });

  it('派生词还原：healthy → health，cultural → culture', () => {
    expect(normalizeToken('healthy')).toContain('health');
    expect(normalizeToken('cultural')).toContain('culture');
  });

  it("所有格与 o'clock 拆分：china's → china，o'clock → clock", () => {
    expect(normalizeToken("china's")).toContain('china');
    expect(normalizeToken("o'clock")).toContain('clock');
  });

  it("n't 收缩展开后同时给出 not", () => {
    expect(normalizeToken("isn't")).toContain('not');
    expect(normalizeToken("doesn't")).toContain('not');
  });

  it('NFKC：全角字母与半角等价', () => {
    expect(normalizeToken('Ｄｅｖｅｌｏｐｍｅｎｔ')[0]).toBe('development');
  });

  it('IRREGULAR 表不含自指条目（key !== value），避免无效还原', () => {
    for (const [key, value] of Object.entries(IRREGULAR)) {
      expect(key).not.toBe(value);
    }
  });
});

describe('candidateSetOf', () => {
  it('返回 Set 且与 normalizeToken 同构', () => {
    const set = candidateSetOf('Studies');
    expect(set).toBeInstanceOf(Set);
    expect([...set]).toEqual(normalizeToken('Studies'));
    expect(set.has('study')).toBe(true);
  });
});
