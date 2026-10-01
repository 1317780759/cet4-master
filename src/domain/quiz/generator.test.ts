import { describe, expect, it } from 'vitest';
import type { Tier, Word } from '@/domain/word/types';
import { generateQuiz } from './generator';

/**
 * 测验生成器单测 —— 重点验证"这不是一套废题"：
 * 选项不重复、干扰项像真的、结果可复现、凑不出 4 个选项就直接弃题。
 */

function makeWord(headword: string, zh: string, rank: number, tier: Tier = 'cet4'): Word {
  return {
    id: `w_${headword}`,
    headword,
    variants: [],
    senses: [{ pos: 'unknown', zh }],
    freqRank: rank,
    freqCount: 40,
    tier,
    chunk: 1,
    sentenceCount: 0,
    source: 'exam-data/CETVocabulary@test',
    license: 'CC BY-NC-SA 4.0',
  };
}

/** 20 个词，释义互不相同，长度分布有差异 */
const WORDS: Word[] = Array.from({ length: 20 }, (_, i) =>
  makeWord(`word${i}`, `释义${i}`, i + 1, i < 12 ? 'cet4' : 'extended' as Tier),
);

describe('generateQuiz · 基本形态', () => {
  it('生成指定题数，每题 4 个选项，键为 A–D', () => {
    const qs = generateQuiz({ words: WORDS, count: 5, seed: 42 });
    expect(qs).toHaveLength(5);
    for (const q of qs) {
      expect(q.options).toHaveLength(4);
      expect(q.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
    }
  });

  it('★ 四个选项文本互不重复（有歧义的题不是难题，是错题）', () => {
    const qs = generateQuiz({ words: WORDS, count: 10, seed: 7 });
    for (const q of qs) {
      const texts = q.options.map((o) => o.text.trim().toLowerCase());
      expect(new Set(texts).size).toBe(4);
    }
  });

  it('★ answerKey 指向的确实是正确答案文本', () => {
    const byId = new Map(WORDS.map((w) => [w.id, w]));
    for (const direction of ['en-to-zh', 'zh-to-en'] as const) {
      const qs = generateQuiz({ words: WORDS, count: 8, seed: 3, direction });
      for (const q of qs) {
        const answer = q.options.find((o) => o.key === q.answerKey)!;
        const target = byId.get(q.wordId)!;
        const expected =
          direction === 'en-to-zh'
            ? target.senses[0]!.zh
            : target.headword;
        expect(answer.text).toBe(expected);
        // 且正确答案的来源词就是被考词（不是某个干扰项）
        expect(answer.wordId).toBe(q.wordId);
      }
    }
  });

  it('题干方向正确', () => {
    const byId = new Map(WORDS.map((w) => [w.id, w]));
    const en2zh = generateQuiz({ words: WORDS, count: 3, seed: 1, direction: 'en-to-zh' });
    expect(en2zh[0]!.stem).toBe(byId.get(en2zh[0]!.wordId)!.headword);

    const zh2en = generateQuiz({ words: WORDS, count: 3, seed: 1, direction: 'zh-to-en' });
    expect(zh2en[0]!.stem).toBe(byId.get(zh2en[0]!.wordId)!.senses[0]!.zh);
  });

  it('干扰项不含被考词本身', () => {
    const qs = generateQuiz({ words: WORDS, count: 10, seed: 11 });
    for (const q of qs) {
      expect(q.distractorWordIds).not.toContain(q.wordId);
      expect(new Set(q.distractorWordIds).size).toBe(3);
    }
  });
});

describe('generateQuiz · 可复现性', () => {
  it('★ 同 seed 必得同一套题（支持"重做同一套" + 单测可断言）', () => {
    const a = generateQuiz({ words: WORDS, count: 6, seed: 2026 });
    const b = generateQuiz({ words: WORDS, count: 6, seed: 2026 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('不同 seed 得到不同题目顺序 / 选项顺序', () => {
    const a = generateQuiz({ words: WORDS, count: 6, seed: 1 });
    const b = generateQuiz({ words: WORDS, count: 6, seed: 999 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('generateQuiz · 退化输入不产出残次题', () => {
  it('★ 干扰项池不足时**弃题**，而不是产出三选一/二选一（蒙对率会失真）', () => {
    // 只有 2 个词 → 凑不出 3 个干扰项
    expect(generateQuiz({ words: WORDS.slice(0, 2), count: 5, seed: 1 })).toHaveLength(0);
    // 3 个词 → 最多凑 2 个干扰项，仍不足
    expect(generateQuiz({ words: WORDS.slice(0, 3), count: 5, seed: 1 })).toHaveLength(0);
    // 4 个词 → 恰好够 1 题
    expect(generateQuiz({ words: WORDS.slice(0, 4), count: 5, seed: 1 })).toHaveLength(1);
  });

  it('无释义的词不参与出题', () => {
    const blank = { ...makeWord('blankword', '释义X', 99), senses: [] };
    const qs = generateQuiz({ words: [blank, ...WORDS], count: 20, seed: 5 });
    expect(qs.every((q) => q.wordId !== blank.id)).toBe(true);
  });

  it('释义撞车的干扰项会被剔除（不会产生两个"看起来都对"的选项）', () => {
    // 3 个词释义完全相同 → 任何一题都无法凑出 3 个不同文本的干扰项
    const dupes = [
      makeWord('dup1', '同一个意思', 1),
      makeWord('dup2', '同一个意思', 2),
      makeWord('dup3', '同一个意思', 3),
      makeWord('dup4', '同一个意思', 4),
    ];
    expect(generateQuiz({ words: dupes, count: 4, seed: 1 })).toHaveLength(0);
  });
});

describe('generateQuiz · 干扰项质量', () => {
  it('同 tier 的词被优先选为干扰项（避免"一眼看出答案"）', () => {
    // 前 12 个 cet4、后 8 个 extended；考一个 cet4 词时干扰项应多为 cet4
    const target = WORDS[0]!; // tier=cet4
    const qs = generateQuiz({ words: [target, ...WORDS], count: 1, seed: 8, distractorPool: WORDS });
    const q = qs[0]!;
    const byId = new Map(WORDS.map((w) => [w.id, w]));
    const sameTier = q.distractorWordIds.filter((id) => byId.get(id)!.tier === target.tier).length;
    expect(sameTier).toBeGreaterThanOrEqual(2);
  });

  it('被考词不会在两套题里重复出现（一次测验内不考两遍）', () => {
    const qs = generateQuiz({ words: WORDS, count: 10, seed: 4 });
    const ids = qs.map((q) => q.wordId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
