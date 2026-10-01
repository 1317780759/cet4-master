/**
 * FSRS ↔ 领域对象 适配器 —— 铁律 A1：纯函数，零 React / 零 IO / 零网络。
 *
 * 职责：在「可入库的 ReviewCard（epoch ms 数字）」与「ts-fsrs 的 Card（Date 对象）」
 * 之间做双向映射。之所以要这层，是因为 Date 无法直接作为 IndexedDB 索引排序，
 * 而 ts-fsrs 只认 Date。
 */

import { createEmptyCard, forgetting_curve, FSRS5_DEFAULT_DECAY, type Card } from 'ts-fsrs';
import type { ReviewCard } from './types';

/**
 * ReviewCard → ts-fsrs Card。
 *
 * ★ `learning_steps` 必须回填（缺省 0）：这是 ts-fsrs 短时调度的游标，
 * 丢失它会让 Learning 卡片永远停在原地（见 __tests__/adapter.test.ts 的回归断言）。
 */
export function toFsrsCard(card: ReviewCard): Card {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps ?? 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as Card['state'],
    last_review: card.lastReview === undefined ? undefined : new Date(card.lastReview),
  };
}

/**
 * ts-fsrs Card → ReviewCard。
 *
 * 进度元信息（wordId / suspended / createdAt / introsRank）不在 ts-fsrs 的 Card 里，
 * 因此必须从**旧卡**透传，保证用户进度与词频档位信息不丢。
 */
export function fromFsrsCard(source: Card, previous: ReviewCard): ReviewCard {
  return {
    wordId: previous.wordId,
    due: source.due.getTime(),
    stability: source.stability,
    difficulty: source.difficulty,
    elapsedDays: source.elapsed_days,
    scheduledDays: source.scheduled_days,
    reps: source.reps,
    lapses: source.lapses,
    state: source.state,
    lastReview: source.last_review === undefined ? undefined : source.last_review.getTime(),
    suspended: previous.suspended,
    createdAt: previous.createdAt,
    introsRank: previous.introsRank,
    learningSteps: source.learning_steps,
  };
}

/** 新建一张 ts-fsrs 空卡（New 状态，due = now） */
export function emptyFsrsCard(now: number): Card {
  return createEmptyCard(new Date(now));
}

/** 当前卡片的可读性（0..1），用于 UI 提示「该复习了」。无稳定性时返回 0 */
export function retrievability(card: ReviewCard, now: number): number {
  if (card.stability <= 0 || card.lastReview === undefined) return 0;
  const elapsedDays = Math.max(0, (now - card.lastReview) / 86_400_000);
  // 直接复用 ts-fsrs 的遗忘曲线（FSRS-5 默认 decay=0.5），保证与调度口径一致
  const value = forgetting_curve(FSRS5_DEFAULT_DECAY, elapsedDays, card.stability);
  return Math.min(1, Math.max(0, value));
}
