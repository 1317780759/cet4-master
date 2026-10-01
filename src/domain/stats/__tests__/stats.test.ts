import { describe, expect, it } from 'vitest';
import {
  applyLogToDailyStat,
  buildTrend,
  hasActivityOn,
  lastActiveDate,
  masteryTotal,
  summarizeDay,
  type DailyStatLike,
  type StudyLogLike,
} from '../aggregate';
import { activityFromStats, buildHeatmap, levelOf } from '../heatmap';
import { activeDates, currentStreak, longestStreak } from '../streak';

const TODAY = '2026-10-01';

function log(partial: Partial<StudyLogLike> & { ts: number }): StudyLogLike {
  return { date: TODAY, wordId: 'w_x', action: 'review', ...partial };
}

describe('domain/stats/aggregate', () => {
  it('summarizeDay 聚合今日事件', () => {
    const logs: StudyLogLike[] = [
      log({ ts: 1, action: 'learn', rating: 4, elapsedMs: 30_000 }),
      log({ ts: 2, action: 'review', rating: 1, elapsedMs: 20_000 }),
      log({ ts: 3, action: 'review', rating: 3, elapsedMs: 10_000 }),
      log({ ts: 4, date: '2026-09-30', action: 'review', rating: 4 }),
    ];
    const s = summarizeDay(logs, TODAY, 20);
    expect(s.newLearned).toBe(1);
    expect(s.reviewed).toBe(3);
    expect(s.correct).toBe(2);
    expect(s.wrong).toBe(1);
    expect(s.minutes).toBe(1);
    expect(s.accuracy).toBeCloseTo(2 / 3, 6);
    expect(s.goalDone).toBe(false);
    expect(s.goalRatio).toBeCloseTo(1 / 20, 6);
  });

  it('applyLogToDailyStat 增量累加且纯函数', () => {
    const base: DailyStatLike = {
      date: TODAY,
      newLearned: 1,
      reviewed: 3,
      correct: 2,
      wrong: 1,
      minutes: 1,
      goalDone: false,
    };
    const snapshot = JSON.stringify(base);
    const next = applyLogToDailyStat(base, log({ ts: 9, action: 'learn', rating: 3, elapsedMs: 60_000 }), 3);
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(next.newLearned).toBe(2);
    expect(next.reviewed).toBe(4);
    expect(next.correct).toBe(3);
    expect(next.minutes).toBe(2);
    expect(next.goalDone).toBe(false);
  });

  it('applyLogToDailyStat 从 null 起步', () => {
    const next = applyLogToDailyStat(null, log({ ts: 1, action: 'learn', rating: 1 }), 1);
    expect(next).toMatchObject({ date: TODAY, newLearned: 1, wrong: 1, goalDone: true });
  });

  it('buildTrend 补齐缺失日期为 0', () => {
    const stats: DailyStatLike[] = [
      { date: '2026-09-30', newLearned: 5, reviewed: 10, correct: 8, wrong: 2, minutes: 3, goalDone: true },
    ];
    const trend = buildTrend(stats, 3, TODAY);
    expect(trend.map((p) => p.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(trend[1].reviewed).toBe(10);
    expect(trend[2].reviewed).toBe(0);
  });

  it('masteryTotal 求和', () => {
    expect(masteryTotal({ new: 1, learning: 2, young: 3, mature: 4 })).toBe(10);
  });

  it('hasActivityOn / lastActiveDate', () => {
    const stats: DailyStatLike[] = [
      { date: '2026-09-28', newLearned: 0, reviewed: 0, correct: 0, wrong: 0, minutes: 0, goalDone: false },
      { date: '2026-09-29', newLearned: 1, reviewed: 1, correct: 1, wrong: 0, minutes: 1, goalDone: false },
    ];
    expect(hasActivityOn(stats, '2026-09-29')).toBe(true);
    expect(hasActivityOn(stats, '2026-09-28')).toBe(false);
    expect(lastActiveDate(stats)).toBe('2026-09-29');
    expect(lastActiveDate([])).toBeNull();
  });
});

describe('domain/stats/streak', () => {
  it('currentStreak：今天有记录从今天数', () => {
    expect(currentStreak(['2026-10-01', '2026-09-30', '2026-09-29'], TODAY)).toBe(3);
  });

  it('currentStreak：今天没记录但昨天有 → 从昨天数（未断）', () => {
    expect(currentStreak(['2026-09-30', '2026-09-29'], TODAY)).toBe(2);
  });

  it('currentStreak：断档或全无 → 0', () => {
    expect(currentStreak(['2026-09-28'], TODAY)).toBe(0);
    expect(currentStreak([], TODAY)).toBe(0);
  });

  it('longestStreak 取历史最长', () => {
    expect(longestStreak(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10'])).toBe(3);
    expect(longestStreak([])).toBe(0);
  });

  it('activeDates 过滤零活动', () => {
    expect(
      activeDates([
        { date: '2026-09-01', reviewed: 0, newLearned: 0 },
        { date: '2026-09-02', reviewed: 5, newLearned: 0 },
      ]),
    ).toEqual(['2026-09-02']);
  });
});

describe('domain/stats/heatmap', () => {
  it('levelOf 五档映射', () => {
    expect(levelOf(0, 100)).toBe(0);
    expect(levelOf(1, 1)).toBe(4);
    expect(levelOf(10, 100)).toBe(1);
    expect(levelOf(50, 100)).toBe(2);
    expect(levelOf(75, 100)).toBe(3);
    expect(levelOf(100, 100)).toBe(4);
  });

  it('buildHeatmap 生成 weeks×7 网格且末列对齐本周', () => {
    const grid = buildHeatmap(new Map([[TODAY, 5]]), { weeks: 4, today: TODAY });
    expect(grid.weeks).toHaveLength(4);
    expect(grid.weeks.every((c) => c.length === 7)).toBe(true);
    expect(grid.total).toBe(5);
    const flat = grid.weeks.flat();
    const cell = flat.find((c) => c.date === TODAY);
    expect(cell?.count).toBe(5);
    expect(cell?.future).toBe(false);
    // 未来格 level 强制 0
    expect(flat.filter((c) => c.future).every((c) => c.level === 0)).toBe(true);
  });

  it('activityFromStats 累加 reviewed + newLearned', () => {
    const map = activityFromStats([{ date: TODAY, reviewed: 3, newLearned: 2 }]);
    expect(map.get(TODAY)).toBe(5);
  });
});
