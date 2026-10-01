import { create } from 'zustand';
import type { ScheduleResult } from '@/domain/fsrs/scheduler';
import type { FsrsRating, RatingInput } from '@/domain/fsrs/types';
import {
  finishSession,
  previewIntervals,
  rateWord,
  startSession,
  type SessionMode,
  type SessionSummary,
  type StudyItem,
} from '@/services/studySession';
import { describeError } from '@/lib/result';
import { useSettingsStore } from './useSettingsStore';

/**
 * 背词会话状态镜像（Zustand 薄壳）。
 *
 * 业务动作全部委托给 `services/studySession`（选词 / 评级的唯一入口），
 * 本 store 只负责「游标 / 翻卡 / 队列」这些 UI 侧状态。
 */

export type StudyPhase = 'idle' | 'loading' | 'studying' | 'finished' | 'empty' | 'error';

export interface StudyState {
  phase: StudyPhase;
  mode: SessionMode;
  queue: StudyItem[];
  cursor: number;
  revealed: boolean;
  newCount: number;
  reviewCount: number;
  /** 本会话完成评级次数（含 Again 重现） */
  rated: number;
  summary: SessionSummary | null;
  error: string | null;
  /** 当前卡片展示时刻（用于 elapsedMs） */
  shownAt: number;

  start: (mode: SessionMode) => Promise<void>;
  reveal: () => void;
  rate: (self: RatingInput['self']) => Promise<void>;
  skip: () => void;
  finish: () => Promise<void>;
  reset: () => void;
}

const INITIAL = {
  phase: 'idle' as StudyPhase,
  mode: 'learn' as SessionMode,
  queue: [] as StudyItem[],
  cursor: 0,
  revealed: false,
  newCount: 0,
  reviewCount: 0,
  rated: 0,
  summary: null as SessionSummary | null,
  error: null as string | null,
  shownAt: 0,
};

export const useStudyStore = create<StudyState>((set, get) => ({
  ...INITIAL,

  start: async (mode: SessionMode): Promise<void> => {
    set({ ...INITIAL, phase: 'loading', mode });
    const settings = useSettingsStore.getState().settings;
    try {
      const queue = await startSession(mode, {
        tier: settings.tier,
        dailyGoal: settings.dailyGoal,
        reviewLimit: settings.reviewLimit,
        freqOrdering: settings.freqOrdering,
      });
      if (queue.items.length === 0) {
        set({ phase: 'empty', queue: [], newCount: 0, reviewCount: 0 });
        return;
      }
      set({
        phase: 'studying',
        queue: queue.items,
        cursor: 0,
        revealed: false,
        newCount: queue.newCount,
        reviewCount: queue.reviewCount,
        rated: 0,
        shownAt: Date.now(),
      });
    } catch (error) {
      set({ phase: 'error', error: describeError(error) });
    }
  },

  reveal: (): void => {
    if (get().phase !== 'studying') return;
    set({ revealed: true });
  },

  rate: async (self: RatingInput['self']): Promise<void> => {
    const state = get();
    if (state.phase !== 'studying') return;
    const item = state.queue[state.cursor];
    if (!item) return;

    const now = Date.now();
    const settings = useSettingsStore.getState().settings;
    const input: RatingInput = {
      self,
      peeked: state.revealed,
      elapsedMs: Math.max(0, now - state.shownAt),
    };

    try {
      const result = await rateWord(item, input, {
        peekPenalty: settings.peekPenalty,
        dailyGoal: settings.dailyGoal,
        now,
      });

      // Again → 当日重现：把该词（携带新卡片状态）追加到队尾，本次会话内会再遇到
      const nextQueue = [...state.queue];
      if (result.requeuedSameDay) {
        nextQueue.push({ ...item, card: result.card, isNew: false });
      }
      const nextCursor = state.cursor + 1;
      const done = nextCursor >= nextQueue.length;

      set({
        queue: nextQueue,
        cursor: nextCursor,
        revealed: false,
        rated: state.rated + 1,
        shownAt: now,
      });

      if (done) await get().finish();
    } catch (error) {
      set({ phase: 'error', error: describeError(error) });
    }
  },

  skip: (): void => {
    const state = get();
    if (state.phase !== 'studying') return;
    const nextCursor = state.cursor + 1;
    set({ cursor: nextCursor, revealed: false, shownAt: Date.now() });
    if (nextCursor >= state.queue.length) void get().finish();
  },

  finish: async (): Promise<void> => {
    try {
      const summary = await finishSession();
      set({ phase: 'finished', summary });
    } catch (error) {
      set({ phase: 'error', error: describeError(error) });
    }
  },

  reset: (): void => {
    set({ ...INITIAL });
  },
}));

/** 当前卡片（组件用） */
export function selectCurrent(state: StudyState): StudyItem | null {
  return state.phase === 'studying' ? (state.queue[state.cursor] ?? null) : null;
}

/** 会话进度 0..1 */
export function selectProgress(state: StudyState): number {
  if (state.queue.length === 0) return 0;
  return Math.min(1, state.cursor / state.queue.length);
}

/** 当前卡片的四评级落点预览 */
export function previewFor(item: StudyItem, now: number = Date.now()): Record<FsrsRating, ScheduleResult> {
  return previewIntervals(item.card, now);
}
