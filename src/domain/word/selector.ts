/**
 * 词频优先选词 —— 差异化机会 ① 的核心算法。
 * 铁律 A1：纯函数，零 React / 零 IO / 零网络，可 100% 单测。
 *
 * 铁律：**学习队列严格按 `freqRank` 升序**（rank 越小 = 真卷出现越多 = 越优先），
 * 由此天然保证 Top2104（高频核心）先被引入，无需额外排序键。
 */

import { TIER_CODE, type Tier, type WordIndexRow } from './types';
import { CORE_BOUNDARY } from './tier';
import type { TierFilter } from '@/domain/settings/types';

export interface SelectOptions {
  /** 取多少个新词（= 每日目标） */
  limit: number;
  /** 档位筛选：core2104 / cet4 / extended / all */
  tier?: TierFilter;
  /** 已学 / 已存在的词 id，必须排除，避免重复引入 */
  exclude?: ReadonlySet<string>;
  /**
   * true（默认）= 严格按词频降序（freqRank 升序）；
   * false = 在候选集内洗牌（R01 的「随机」档）。洗牌用注入的 random，保证可测。
   */
  freqOrdering?: boolean;
  /** 随机源（freqOrdering=false 时使用），默认 Math.random */
  random?: () => number;
}

/** tier 筛选 → 可接受码集合 */
function tierCodes(tier: TierFilter | undefined): ReadonlySet<number> | null {
  if (!tier || tier === 'all') return null;
  return new Set([TIER_CODE[tier as Tier]]);
}

/**
 * 候选新词（已按 freqRank 升序、已排除已学词、已按档位过滤）。
 * 纯函数，不修改入参。
 */
export function newWordCandidates(
  index: readonly WordIndexRow[],
  options: Pick<SelectOptions, 'tier' | 'exclude'> = {},
): WordIndexRow[] {
  const codes = tierCodes(options.tier);
  const exclude = options.exclude;
  const rows = index.filter((row) => {
    if (exclude?.has(row.id)) return false;
    if (codes && !codes.has(row.t)) return false;
    return true;
  });
  // 稳定：freqRank 升序，rank 相同按 id 兜底，保证结果确定
  return rows.sort((a, b) => (a.r === b.r ? (a.id < b.id ? -1 : 1) : a.r - b.r));
}

/**
 * 取一批新词 —— 学习队列的唯一来源。
 *
 * 返回的 id 列表**严格按 freqRank 升序**（freqOrdering=true 时），
 * 这是 M1 验收标准「学习队列严格按 freqRank 升序」的实现点。
 */
export function pickNewWords(
  index: readonly WordIndexRow[],
  options: SelectOptions,
): WordIndexRow[] {
  const limit = Math.max(0, Math.floor(options.limit));
  if (limit === 0) return [];
  const candidates = newWordCandidates(index, options);
  if (options.freqOrdering === false) {
    return shuffle(candidates, options.random ?? Math.random).slice(0, limit);
  }
  return candidates.slice(0, limit);
}

/** Fisher–Yates 洗牌（返回新数组，可注入 random 以便测试） */
export function shuffle<T>(input: readonly T[], random: () => number = Math.random): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 断言一批索引行严格按 freqRank 升序（数据/队列体检） */
export function isStrictlyAscending(rows: readonly Pick<WordIndexRow, 'r'>[]): boolean {
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].r < rows[i - 1].r) return false;
  }
  return true;
}

export interface CoverageReport {
  /** 已引入的 Top2104 词数 */
  coreLearned: number;
  /** Top2104 总数（2104，或词库不足时取实际值） */
  coreTotal: number;
  /** 覆盖率 0..1 */
  ratio: number;
  /** 已引入的总词数 */
  learned: number;
}

/**
 * 「高频词覆盖率」（G1）—— 给定已学词的 freqRank 集合，算 Top2104 覆盖率。
 * 纯函数，UI 与统计页共用。
 */
export function coverage(
  learnedRanks: readonly number[],
  coreBoundary: number = CORE_BOUNDARY,
): CoverageReport {
  let coreLearned = 0;
  for (const rank of learnedRanks) {
    if (rank >= 1 && rank <= coreBoundary) coreLearned += 1;
  }
  return {
    coreLearned,
    coreTotal: coreBoundary,
    ratio: coreBoundary > 0 ? coreLearned / coreBoundary : 0,
    learned: learnedRanks.length,
  };
}
