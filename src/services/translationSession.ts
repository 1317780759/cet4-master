/**
 * 翻译训练会话服务 —— 选题 / 判分 / 落库的编排（零 React）。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.13（会话编排）。
 *
 * ★ 分层：算法在 `src/domain/translation`（纯函数、可 100% 单测），
 *   本文件只做「取数据 → 调评分器 → 写库」的三段式胶水，不含任何评分算法。
 */

import type { Cet4Database } from '@/data/db/db';
import type { TranslationBookRow } from '@/data/db/rows';
import {
  addTranslationBookRow,
  findTranslationBookRow,
  listTranslationsByTopic,
  listUnresolvedTranslationBook,
  removeTranslationBookRow,
} from '@/data/repos/translationRepo';
import { getTranslation } from '@/data/repos/translationRepo';
import { toScore } from '@/domain/translation/scorer';
import { TRANSLATION_TOPIC_KEYS, isTranslationTopicKey } from '@/domain/translation/topics';
import type {
  ScoreRequest,
  ScoreResult,
  TranslationItem,
  TranslationScorer,
  TranslationTopicKey,
} from '@/domain/translation/types';

/** Fisher–Yates 洗牌，`random` 可注入以便单测确定化 */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/** 选题模式 */
export type TranslationMode =
  /** 全部话题随机抽 */
  | 'random'
  /** 指定话题顺序练 */
  | 'topic'
  /** 只做错句本里未掌握的 */
  | 'review';

export interface StartTranslationOptions {
  mode: TranslationMode;
  /** mode='topic' 时必填 */
  topic?: TranslationTopicKey;
  /** 本轮题量 */
  count?: number;
  instance?: Cet4Database;
  /** 可注入的随机源（单测用） */
  random?: () => number;
}

/** 默认一轮 10 句：手机上一口气做完，又不至于太长 */
export const DEFAULT_TRANSLATION_COUNT = 10;

/**
 * 组装本轮题目。
 *
 * `random` 模式跨全部话题打散（而不是先按话题分块），否则「随机」的手感等同于
 * 「先来 20 句传统文化」——那正是用户抱怨「不要从头开始」时想摆脱的东西。
 */
export async function startTranslation(options: StartTranslationOptions): Promise<TranslationItem[]> {
  const { mode, topic, count = DEFAULT_TRANSLATION_COUNT, instance, random } = options;

  if (mode === 'review') {
    const rows = await listUnresolvedTranslationBook(instance);
    const items: TranslationItem[] = [];
    for (const row of rows) {
      if (items.length >= count) break;
      const item = await getTranslation(row.itemId, instance);
      if (item) items.push(item);
    }
    return items;
  }

  if (mode === 'topic') {
    if (!topic || !isTranslationTopicKey(topic)) return [];
    const all = await listTranslationsByTopic(topic, instance);
    return shuffle(all, random).slice(0, count);
  }

  const all: TranslationItem[] = [];
  for (const key of TRANSLATION_TOPIC_KEYS) {
    all.push(...(await listTranslationsByTopic(key, instance)));
  }
  return shuffle(all, random).slice(0, count);
}

/** 组装给评分器的请求（离线和 AI 用的是同一份） */
export function toScoreRequest(item: TranslationItem, myText: string): ScoreRequest {
  return { text: myText, keyPoints: item.keyPoints };
}

/** 组装给 AI 评分器的请求（多带中文原文与参考译文） */
export function toLlmRequest(
  item: TranslationItem,
  myText: string,
): ScoreRequest & { zh: string; reference: string } {
  return { ...toScoreRequest(item, myText), zh: item.zh, reference: item.reference };
}

/** 达到这个命中率即视为"这句掌握了"，不进错句本 */
export const MASTERED_RATIO = 0.8;

export interface SubmitResult {
  score: ScoreResult;
  /** 是否已加入错句本 */
  inBook: boolean;
  /** 本次是否刚加入 */
  added: boolean;
}

/**
 * 提交作答：判分 + 按需写入错句本。
 *
 * ★ 落库策略：命中率 < `MASTERED_RATIO` 才进错句本；已进过的再练达标则自动归档。
 *   这样错句本能真正收敛，而不是越积越多变成压力。
 */
export async function submitTranslation(
  item: TranslationItem,
  myText: string,
  scorer: TranslationScorer,
  now: number = Date.now(),
  instance?: Cet4Database,
): Promise<SubmitResult> {
  const result = await scorer.score(toScoreRequest(item, myText));
  const score = toScore(result);
  const existing = await findTranslationBookRow(item.id, instance);
  const mastered = score.ratio >= MASTERED_RATIO;

  if (mastered) {
    if (existing) {
      await addTranslationBookRow(
        { ...existing, lastText: myText, lastScore: score, lastTriedAt: now, resolved: true },
        instance,
      );
      return { score: result, inBook: true, added: false };
    }
    return { score: result, inBook: false, added: false };
  }

  if (existing) {
    await addTranslationBookRow(
      { ...existing, lastText: myText, lastScore: score, lastTriedAt: now, resolved: false },
      instance,
    );
    return { score: result, inBook: true, added: false };
  }

  const row: TranslationBookRow = {
    itemId: item.id,
    topic: item.topic,
    lastText: myText,
    lastScore: score,
    addedAt: now,
    lastTriedAt: now,
    resolved: false,
  };
  await addTranslationBookRow(row, instance);
  return { score: result, inBook: true, added: true };
}

/** 从错句本移除 */
export function removeFromBook(itemId: string, instance?: Cet4Database): Promise<void> {
  return removeTranslationBookRow(itemId, instance);
}

/** 空作答提示：低于这个长度基本不可能命中得分点，直接拦住不浪费一次 AI 请求 */
export const MIN_TEXT_LENGTH = 10;

export function isTooShort(text: string): boolean {
  return text.trim().length < MIN_TEXT_LENGTH;
}
