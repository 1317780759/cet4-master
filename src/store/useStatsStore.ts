import { create } from 'zustand';
import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import { listDailyStats, listLogsByDate } from '@/data/repos/logRepo';
import { getLastBackupAt } from '@/data/repos/settingsRepo';
import { countWords } from '@/data/repos/wordRepo';
import { masteryBucket } from '@/domain/fsrs/scheduler';
import {
  buildTrend,
  summarizeDay,
  type MasteryDistribution,
  type TodaySummary,
  type TrendPoint,
} from '@/domain/stats/aggregate';
import { activityFromStats, buildHeatmap, type HeatmapGrid } from '@/domain/stats/heatmap';
import { activeDates, currentStreak, longestStreak } from '@/domain/stats/streak';
import { coverage, type CoverageReport } from '@/domain/word/selector';
import { toDateKey } from '@/lib/date';
import { describeError } from '@/lib/result';
import { countDueCards } from '@/services/reviewQueue';
import { useSettingsStore } from './useSettingsStore';

/** 首页统计快照（一次 load 取全，避免 Dashboard 里散落多个 useEffect） */
export interface DashboardData {
  today: TodaySummary;
  streak: number;
  longest: number;
  mastery: MasteryDistribution;
  masteryTotal: number;
  trend7: TrendPoint[];
  trend30: TrendPoint[];
  heatmap: HeatmapGrid;
  dueCount: number;
  totalCards: number;
  suspended: number;
  wordCount: number;
  /** 高频词覆盖率（G1） */
  coverage: CoverageReport;
  lastBackupAt: number | null;
}

export interface StatsState {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  load: (instance?: Cet4Database) => Promise<void>;
}

export const useStatsStore = create<StatsState>((set) => ({
  data: null,
  loading: false,
  error: null,

  load: async (instance: Cet4Database = defaultDb): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const settings = useSettingsStore.getState().settings;
      const today = toDateKey();
      const [logs, stats, cards, dueCount, wordCount, lastBackupAt] = await Promise.all([
        listLogsByDate(today, instance),
        listDailyStats(400, instance),
        instance.cards.toArray(),
        countDueCards(Date.now(), instance),
        countWords(instance),
        getLastBackupAt(instance),
      ]);

      const mastery: MasteryDistribution = { new: 0, learning: 0, young: 0, mature: 0 };
      let suspended = 0;
      const ranks: number[] = [];
      for (const card of cards) {
        mastery[masteryBucket(card)] += 1;
        ranks.push(card.introsRank);
        if (card.suspended) suspended += 1;
      }

      const dates = activeDates(stats);
      set({
        data: {
          today: summarizeDay(logs, today, settings.dailyGoal),
          streak: currentStreak(dates, today),
          longest: longestStreak(dates),
          mastery,
          masteryTotal: cards.length,
          trend7: buildTrend(stats, 7, today),
          trend30: buildTrend(stats, 30, today),
          heatmap: buildHeatmap(activityFromStats(stats), { weeks: 26, today }),
          dueCount,
          totalCards: cards.length,
          suspended,
          wordCount,
          coverage: coverage(ranks),
          lastBackupAt,
        },
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },
}));
