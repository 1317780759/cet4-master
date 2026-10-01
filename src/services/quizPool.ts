import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import { getWords, getWordsByRank } from '@/data/repos/wordRepo';
import { listWrong } from '@/data/repos/wrongRepo';
import { listVocab } from '@/data/repos/vocabRepo';
import { listDue } from '@/data/repos/cardRepo';
import { CET4_BOUNDARY, CORE_BOUNDARY } from '@/domain/word/tier';
import { createSeededRandom } from '@/domain/quiz/generator';
import type { TierFilter } from '@/domain/settings/types';
import type { Word } from '@/domain/word/types';

/**
 * 测验词池 —— 服务编排层（有 IO）。
 *
 * ★ 与 `generateQuiz` 的分工：
 *   generateQuiz 只负责"给定一批词 → 出一套像样的题"（纯函数）；
 *   本文件负责"从本机进度里挑出**该考哪些词**"（要读 IndexedDB）。
 *   两者分开，出题逻辑才能保持可单测。
 */

export type QuizPoolSource =
  /** 已学过的词（有复习卡片） */
  | 'learned'
  /** 今天到期的词 */
  | 'due'
  /** 错题本里的词 */
  | 'wrong'
  /** 主动收藏的生词本 */
  | 'vocab'
  /** 按词频档位直接取（还没学过也能考） */
  | 'rank';

/** 词频档位 → freqRank 区间（纯函数，单测覆盖） */
export function rankRangeForTier(tier: TierFilter): [number, number] {
  switch (tier) {
    case 'core2104':
      return [1, CORE_BOUNDARY];
    case 'cet4':
      return [CORE_BOUNDARY + 1, CET4_BOUNDARY];
    case 'extended':
      return [CET4_BOUNDARY + 1, Number.MAX_SAFE_INTEGER];
    default:
      return [1, Number.MAX_SAFE_INTEGER];
  }
}

/** 按 tier 过滤（'all' 不过滤） */
export function filterByTier(words: readonly Word[], tier: TierFilter): Word[] {
  if (tier === 'all') return [...words];
  return words.filter((w) => w.tier === tier);
}

/**
 * 确定性洗牌后取前 n 个。
 * ★ 用注入的 seed 而非 Math.random：同一 seed 必得同一批词，
 *   既让"重做同一套"成为可能，也让单测能断言。
 */
export function takeShuffled(words: readonly Word[], count: number, seed: number): Word[] {
  const rand = createSeededRandom(seed);
  const arr = [...words];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, Math.max(0, count));
}

export interface QuizPoolInput {
  source: QuizPoolSource;
  tier: TierFilter;
  /** 期望题数 */
  count: number;
  seed: number;
  now?: number;
  instance?: Cet4Database;
  /** 干扰项池上限（全库 5000+ 词没必要全取） */
  distractorLimit?: number;
}

export interface QuizPool {
  /** 被考词（已按 seed 洗牌，长度 ≤ count） */
  targets: Word[];
  /** 干扰项池 */
  distractors: Word[];
}

/** 按来源取出"该考的词" */
async function loadTargets(input: QuizPoolInput, instance: Cet4Database, now: number): Promise<Word[]> {
  const { source, tier, count, seed } = input;

  switch (source) {
    case 'learned': {
      const cards = await instance.cards.toArray();
      const words = await getWords(
        cards.filter((c) => !c.suspended).map((c) => c.wordId),
        instance,
      );
      return takeShuffled(filterByTier(words, tier), count, seed);
    }
    case 'due': {
      const due = await listDue(now, Math.max(count * 4, 50), instance);
      const words = await getWords(due.map((c) => c.wordId), instance);
      return takeShuffled(filterByTier(words, tier), count, seed);
    }
    case 'wrong': {
      const rows = await listWrong({ limit: 500 }, instance);
      const words = await getWords(
        rows.map((r) => r.wordId).filter((id): id is string => typeof id === 'string'),
        instance,
      );
      return takeShuffled(filterByTier(words, tier), count, seed);
    }
    case 'vocab': {
      const rows = await listVocab(500, instance);
      const words = await getWords(rows.map((r) => r.wordId), instance);
      return takeShuffled(filterByTier(words, tier), count, seed);
    }
    default: {
      const [from, to] = rankRangeForTier(tier);
      const words = await getWordsByRank(from, Math.min(to, CET4_BOUNDARY), instance);
      return takeShuffled(words, count, seed);
    }
  }
}

/**
 * 组装测验词池。
 *
 * ★ 干扰项池刻意**比被考池大**：只有池子足够大，
 *   生成器才挑得出"同档位 + 词长接近"的像样干扰项（否则会出"一眼看出答案"的废题）。
 */
export async function loadQuizPool(input: QuizPoolInput): Promise<QuizPool> {
  const instance = input.instance ?? defaultDb;
  const now = input.now ?? Date.now();
  const limit = input.distractorLimit ?? 1200;

  const targets = await loadTargets(input, instance, now);
  const [from, to] = rankRangeForTier(input.tier);
  const distractors = await getWordsByRank(from, Math.min(to, CET4_BOUNDARY), instance);

  return {
    targets,
    distractors: distractors.slice(0, limit),
  };
}
