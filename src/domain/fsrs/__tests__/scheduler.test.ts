import { describe, expect, it } from 'vitest';
import {
  formatInterval,
  isDue,
  masteryBucket,
  next,
  preview,
  requeueSameDay,
  SAME_DAY_REQUEUE_MS,
  schedule,
} from '../scheduler';
import { createCard, RATING_VALUES, type FsrsRating, type ReviewCard } from '../types';

const T0 = new Date('2025-01-01T00:00:00.000Z').getTime();
const MIN = 60_000;

function card(rank = 1): ReviewCard {
  return createCard(`w_${rank}`, rank, T0);
}

describe('domain/fsrs/scheduler · 原始 FSRS 行为（默认参数，R7 不调参）', () => {
  it('新卡 Again → ts-fsrs 默认约 1 分钟后重现', () => {
    const result = next(card(), 1, T0);
    const minutes = (result.due - T0) / MIN;
    expect(minutes).toBeCloseTo(1, 5);
  });

  it('新卡 Good → ts-fsrs 默认 10 分钟后（学习步骤），状态为 Learning', () => {
    const result = next(card(), 3, T0);
    expect((result.due - T0) / MIN).toBeCloseTo(10, 5);
    expect(result.state).toBe(1);
  });
});

describe('domain/fsrs/scheduler · 应用层策略：Again 当日重现', () => {
  /**
   * ★ M1 验收核心断言一：Again → 当日重现，且**不晚于 Hard**（顺序保护）。
   * 新卡场景 ts-fsrs 的 Hard = 6 分钟，故 Again 收敛到 6 分钟，不再「越不会越晚见」。
   */
  it('新卡 Again → due === hardDue（当日重现，不倒挂）', () => {
    const hardDue = schedule(card(), 2, T0).card.due;
    const { card: updated, requeuedSameDay } = schedule(card(), 1, T0);
    expect(requeuedSameDay).toBe(true);
    expect(updated.due).toBe(hardDue); // ★ === hardDue（新卡=6min），而非固定的 10 分钟
    expect(updated.due - T0).toBeLessThanOrEqual(SAME_DAY_REQUEUE_MS);
    expect(updated.scheduledDays).toBe(0);
  });

  /**
   * ★ 顺序不变式回归：新卡 Again ≤ Hard ≤ Good，且三者同日内（< 24h）。
   * 该缺陷正是从 preview 暴露出来的，故显式锁住三档先后顺序。
   */
  it('新卡顺序不变式：dueAgain ≤ dueHard ≤ dueGood，且三者同日', () => {
    const dueAgain = schedule(card(), 1, T0).card.due;
    const dueHard = schedule(card(), 2, T0).card.due;
    const dueGood = schedule(card(), 3, T0).card.due;
    expect(dueAgain).toBeLessThanOrEqual(dueHard);
    expect(dueHard).toBeLessThanOrEqual(dueGood);
    for (const due of [dueAgain, dueHard, dueGood]) {
      expect(due - T0).toBeLessThan(24 * 3_600_000);
    }
  });

  it('成熟卡（Review）Again → 精确 10 分钟后重现（保留原精确断言），且进入 Relearning', () => {
    let cur = card();
    let at = T0;
    for (let i = 0; i < 4; i += 1) {
      const r = schedule(cur, 3, at);
      cur = r.card;
      at = cur.due;
    }
    expect(cur.state).toBe(2); // Review
    const { card: lapsed, requeuedSameDay } = schedule(cur, 1, at);
    expect(requeuedSameDay).toBe(true);
    expect(lapsed.due - at).toBe(SAME_DAY_REQUEUE_MS); // ★ 成熟卡仍是精确 600000ms
    expect((lapsed.due - at) / MIN).toBeCloseTo(10, 5);
    expect(lapsed.state).toBe(3); // Relearning
    expect(lapsed.lapses).toBe(1);
  });

  it('requeueSameDay 是纯函数：不修改入参（缺省 hardDue=+∞ 时退化为 now+10min）', () => {
    const original = card();
    const snapshot = JSON.stringify(original);
    const updated = requeueSameDay(original, T0);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(updated).not.toBe(original);
    expect(updated.due).toBe(T0 + SAME_DAY_REQUEUE_MS);
  });
});

describe('domain/fsrs/scheduler · 应用层策略：Good 间隔递增', () => {
  /**
   * ★ M1 验收核心断言二：Good → 间隔递增。
   * 时间轴推进到每次到期时刻，连续 Good，scheduledDays 必须严格递增。
   */
  it('连续 Good → scheduledDays 严格递增（2 → 11 → 46 → 163 …）', () => {
    let cur = card();
    let at = T0;
    const intervals: number[] = [];

    // 首次 Good（学习中，10 分钟）
    let step = schedule(cur, 3, at);
    cur = step.card;
    at = cur.due;
    expect(cur.state).toBe(1);

    // 之后连续 Good，进入复习并逐步拉长
    for (let i = 0; i < 4; i += 1) {
      step = schedule(cur, 3, at);
      cur = step.card;
      at = cur.due;
      intervals.push(cur.scheduledDays);
    }

    expect(intervals).toEqual([2, 11, 46, 163]);
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
    expect(cur.state).toBe(2);
  });

  it('persist 回归：learningSteps 若不落库会卡死在 Learning，落库后正常进入 Review', () => {
    // 模拟「丢失 learningSteps」：每轮把 learning_steps 重置为 0
    let bad = card();
    let at = T0;
    for (let i = 0; i < 4; i += 1) {
      const step = schedule({ ...bad, learningSteps: 0 }, 3, at);
      bad = step.card;
      at = bad.due;
      bad = { ...bad, learningSteps: 0 };
    }
    expect(bad.state).toBe(1); // 永远停在 Learning —— 正是要避免的 bug

    // 正常持久化：能进入 Review 且间隔递增
    let good = card();
    at = T0;
    for (let i = 0; i < 4; i += 1) {
      const step = schedule(good, 3, at);
      good = step.card;
      at = good.due;
    }
    expect(good.state).toBe(2);
    expect(good.scheduledDays).toBeGreaterThan(0);
  });
});

describe('domain/fsrs/scheduler · 辅助函数', () => {
  it('preview 覆盖 4 个评级，四档落点顺序不变式 Again ≤ Hard ≤ Good ≤ Easy', () => {
    const p = preview(card(), T0);
    expect(Object.keys(p)).toHaveLength(RATING_VALUES.length);
    const due = (r: FsrsRating): number => p[r].card.due;
    expect(due(1)).toBeLessThanOrEqual(due(2));
    expect(due(2)).toBeLessThanOrEqual(due(3));
    expect(due(3)).toBeLessThanOrEqual(due(4));
    // Again 落点与 schedule 一致（顺序保护后 = hardDue，不再是固定 10 分钟）
    expect(p[1].card.due).toBe(schedule(card(), 1, T0).card.due);
    expect(p[1].card.due).toBe(schedule(card(), 2, T0).card.due);
    for (const rating of RATING_VALUES) {
      expect(p[rating].card.due).toBeGreaterThan(T0);
    }
  });

  it('isDue 尊重 suspended', () => {
    expect(isDue(card(), T0)).toBe(true);
    expect(isDue({ ...card(), suspended: true }, T0)).toBe(false);
    expect(isDue({ ...card(), due: T0 + 10 * MIN }, T0)).toBe(false);
  });

  it('formatInterval 人类可读', () => {
    expect(formatInterval(T0, T0 + 10 * MIN)).toBe('10 分钟');
    expect(formatInterval(T0, T0 + 3 * 3_600_000)).toBe('3 小时');
    expect(formatInterval(T0, T0 + 8 * 86_400_000)).toBe('8 天');
  });

  it('masteryBucket 按状态与间隔归档', () => {
    expect(masteryBucket(card())).toBe('new');
    expect(masteryBucket({ ...card(), state: 1, reps: 1 })).toBe('learning');
    expect(masteryBucket({ ...card(), state: 2, reps: 3, scheduledDays: 5 })).toBe('young');
    expect(masteryBucket({ ...card(), state: 2, reps: 5, scheduledDays: 46 })).toBe('mature');
  });
});
