import { describe, expect, it } from 'vitest';
import { sentenceId, slugify, uid, wordId } from '../id';

describe('lib/id', () => {
  it('slugify 归一化特殊字符（保留大小写）', () => {
    expect(slugify('X-ray')).toBe('X_ray');
    expect(slugify("o'clock")).toBe('o_clock');
    expect(slugify('  Well-Being ')).toBe('Well_Being');
  });

  /**
   * 考纲中 may（可能）与 May（五月）、march（行进）与 March（三月）、
   * resume（恢复）与 résumé（简历）是各自独立的词条 —— 主键必须能区分。
   */
  it('大小写与重音不同的词条不会被合并', () => {
    expect(wordId('may')).not.toBe(wordId('May'));
    expect(wordId('march')).not.toBe(wordId('March'));
    expect(wordId('resume')).not.toBe(wordId('résumé'));
  });

  /**
   * ★ 硬约束 6：Word.id 与 freqRank 解耦。
   * 词频重排后同一单词的 id 必须保持不变，否则用户进度（cards / wrongBook）会错位。
   */
  it('词 ID 与词频无关 —— 换序不换 id', () => {
    expect(wordId('abandon')).toBe('w_abandon');
    expect(wordId('abandon')).not.toContain('1');
    // 同一 headword 无论何时调用，id 恒定
    expect(wordId('abandon')).toBe(wordId('abandon'));
  });

  it('uid 唯一且带前缀', () => {
    const a = uid('attempt');
    const b = uid('attempt');
    expect(a).not.toBe(b);
    expect(a.startsWith('attempt_')).toBe(true);
  });

  it('sentenceId 补零到 6 位', () => {
    expect(sentenceId(42)).toBe('s_000042');
  });
});
