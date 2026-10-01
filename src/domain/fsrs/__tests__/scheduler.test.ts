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

describe('domain/fsrs/scheduler · 应用层策略：Again 当日重现 + 顺序钳制', () => {
  /**
   * ★ M1 验收核心断言一：Again 保留 ts-fsrs 原生落点，并**不晚于 Hard**（顺序钳制）。
   * 断言「不变量 + 区间」，不硬编码魔法数字 —— 便于今后再次优化 Again 落点而不误报。
   */
  it('新卡 Again：不晚于 Hard（不变量）、严格早于 Hard（区分度）、且当日重现', () => {
    const dueHard = schedule(card(), 2, T0).card.due;
    const { card: updated, requeuedSameDay } = schedule(card(), 1, T0);
    expect(requeuedSameDay).toBe(true);
    expect(updated.scheduledDays).toBe(0);

    // 不变量：Again 不晚于 Hard（放宽为 <=）
    expect(updated.due).toBeLessThanOrEqual(dueHard);
    // 区分度：新卡场景 Again 严格早于 Hard（"完全不认识"比"有点模糊"更早见）
    expect(updated.due).toBeLessThan(dueHard);

    // 区间断言：落在 (0, 10min]，且为当日重现（< 24h）
    expect(updated.due - T0).toBeGreaterThan(0);
    expect(updated.due - T0).toBeLessThanOrEqual(SAME_DAY_REQUEUE_MS);
    expect(updated.due - T0).toBeLessThan(24 * 3_600_000);
  });

  /**
   * ★ 顺序不变式回归：新卡 Again < Hard ≤ Good，且三者同日内（< 24h）。
   * 该缺陷正是从 preview 暴露出来的，故显式锁住先后顺序。
   */
  it('新卡顺序不变式：dueAgain < dueHard ≤ dueGood，且三者同日', () => {
    const dueAgain = schedule(card(), 1, T0).card.due;
    const dueHard = schedule(card(), 2, T0).card.due;
    const dueGood = schedule(card(), 3, T0).card.due;
    expect(dueAgain).toBeLessThan(dueHard);
    expect(dueHard).toBeLessThanOrEqual(dueGood);
    for (const due of [dueAgain, dueHard, dueGood]) {
      expect(due - T0).toBeGreaterThan(0);
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
    expect(lapsed.state).toBe(3); // Relearning
    expect(lapsed.lapses).toBe(1);
  });

  it('requeueSameDay 是纯函数：不修改入参，且仅以 hardDue 为上界钳制', () => {
    const original = card(); // due = T0（模拟原生 Again 落点）
    const snapshot = JSON.stringify(original);
    const hardDue = T0 + 10 * MIN;

    // 原生落点早于 hardDue → 保持原生（不延后）
    const kept = requeueSameDay(original, hardDue);
    expect(kept.due).toBe(Math.min(original.due, hardDue));
    expect(kept.scheduledDays).toBe(0);

    // 原生落点晚于 hardDue → 被钳制到 hardDue
    const late = requeueSameDay({ ...original, due: T0 + 999 * MIN }, hardDue);
    expect(late.due).toBe(hardDue);

    // 纯函数：入参未被修改，且返回新对象
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(kept).not.toBe(original);
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
    // 顺序不变式（新卡：Again < Hard ≤ Good ≤ Easy）；Again 严格早于 Hard，二者不同值
    expect(due(1)).toBeLessThan(due(2));
    expect(due(2)).toBeLessThanOrEqual(due(3));
    expect(due(3)).toBeLessThanOrEqual(due(4));
    // Again 落点与 schedule 一致（同一套策略，避免 UI 与实际调度漂移）
    expect(p[1].card.due).toBe(schedule(card(), 1, T0).card.due);
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
