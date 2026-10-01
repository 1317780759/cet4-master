import { describe, expect, it } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { emptyFsrsCard, fromFsrsCard, retrievability, toFsrsCard } from '../adapter';
import { createCard, type ReviewCard } from '../types';

const T0 = new Date('2025-01-01T00:00:00.000Z').getTime();

function baseCard(): ReviewCard {
  return createCard('w_abandon', 12, T0);
}

describe('domain/fsrs/adapter', () => {
  it('ReviewCard → Card：epoch ms 转 Date，learningSteps 缺省为 0', () => {
    const card = baseCard();
    const fsrs = toFsrsCard(card);
    expect(fsrs.due).toBeInstanceOf(Date);
    expect(fsrs.due.getTime()).toBe(T0);
    expect(fsrs.state).toBe(0);
    expect(fsrs.learning_steps).toBe(0);
    expect(fsrs.last_review).toBeUndefined();
  });

  it('Card → ReviewCard：透传进度元信息（wordId/suspended/createdAt/introsRank）', () => {
    const prev = { ...baseCard(), suspended: true, createdAt: T0 - 5000 };
    const source = createEmptyCard(new Date(T0 + 60_000));
    source.stability = 3.5;
    source.difficulty = 5.1;
    source.scheduled_days = 2;
    source.reps = 3;
    source.last_review = new Date(T0);

    const card = fromFsrsCard(source, prev);
    expect(card.wordId).toBe('w_abandon');
    expect(card.suspended).toBe(true);
    expect(card.createdAt).toBe(T0 - 5000);
    expect(card.introsRank).toBe(12);
    expect(card.stability).toBeCloseTo(3.5, 5);
    expect(card.scheduledDays).toBe(2);
    expect(card.reps).toBe(3);
    expect(card.lastReview).toBe(T0);
    expect(card.due).toBe(T0 + 60_000);
  });

  it('往返映射保留 learningSteps（回归：丢失会让 Learning 卡永远推不到 Review）', () => {
    const prev = { ...baseCard(), learningSteps: 1 };
    const source = toFsrsCard(prev);
    source.learning_steps = 1;
    const back = fromFsrsCard(source, prev);
    expect(back.learningSteps).toBe(1);
    expect(toFsrsCard(back).learning_steps).toBe(1);
  });

  it('emptyFsrsCard 生成 New 状态空卡', () => {
    const card = emptyFsrsCard(T0);
    expect(card.state).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.due.getTime()).toBe(T0);
  });

  it('retrievability：未复习过为 0，随时间单调下降', () => {
    const fresh = baseCard();
    expect(retrievability(fresh, T0)).toBe(0);

    const reviewed: ReviewCard = { ...fresh, stability: 10, lastReview: T0 };
    const just = retrievability(reviewed, T0);
    const after3 = retrievability(reviewed, T0 + 3 * 86_400_000);
    const after30 = retrievability(reviewed, T0 + 30 * 86_400_000);
    expect(just).toBeCloseTo(1, 5);
    expect(just).toBeGreaterThan(after3);
    expect(after3).toBeGreaterThan(after30);
    expect(after30).toBeGreaterThan(0);
    expect(after30).toBeLessThan(1);
  });
});
