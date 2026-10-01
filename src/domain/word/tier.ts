import type { Tier, Word } from './types';

/**
 * 词频档位边界 —— 取自 exam-data/CETVocabulary 的统计结论：
 * 前 2104 个单词在约 200 套真卷中出现 40 次以上（平均每 5 套卷必现一次）。
 */
export const CORE_BOUNDARY = 2104;

/** 四级考纲词汇总量（《全国大学英语四、六级考试大纲（2016年修订版）》要求掌握的词汇数） */
export const CET4_BOUNDARY = 5278;

/** freqRank → tier。rank 从 1 开始 */
export function tierOf(freqRank: number): Tier {
  if (freqRank <= CORE_BOUNDARY) return 'core2104';
  if (freqRank <= CET4_BOUNDARY) return 'cet4';
  return 'extended';
}

/** 是否属于高频核心档（Top 2104） */
export function isCore(freqRank: number): boolean {
  return freqRank <= CORE_BOUNDARY;
}

/** tier 的中文展示名 */
export function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'core2104':
      return '高频核心';
    case 'cet4':
      return '四级考纲';
    case 'extended':
      return '扩展';
    default: {
      // 穷尽性保护：新增 Tier 而未同步此处时，编译期即可发现问题
      const exhaustive: never = tier;
      throw new Error(`未处理的 tier: ${String(exhaustive)}`);
    }
  }
}

/** 按 freqRank 升序（= 词频降序）排序，是「词频优先」的唯一排序实现 */
export function byFreqRankAsc(a: Pick<Word, 'freqRank'>, b: Pick<Word, 'freqRank'>): number {
  return a.freqRank - b.freqRank;
}

/** 一批词是否严格按 freqRank 升序且连续（数据体检用） */
export function isRankAscendingAndContinuous(words: readonly Pick<Word, 'freqRank'>[]): boolean {
  for (let i = 0; i < words.length; i += 1) {
    const expected = i + 1;
    if (words[i].freqRank !== expected) return false;
  }
  return true;
}
