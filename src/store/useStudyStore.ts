import { create } from 'zustand';
import type { ScheduleResult } from '@/domain/fsrs/scheduler';
import type { FsrsRating, RatingInput } from '@/domain/fsrs/types';
import { peekDueSoon, REQUEUE_WINDOW_MS } from '@/services/reviewQueue';
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
 *
 * ★ R-A1：新增 `waiting` 相位 —— Again 重现卡在其 `notBefore`（= 卡片 due）之前
 *   不得展示；队列「暂空」但仍有临期卡时进入 waiting（倒计时/可强制继续），
 *   **绝不**静默当作「本组完成」。
 * ★ R-A2：同一词在一次会话内连续 Again 时，队内已有其待答副本则**原地更新**，不堆积。
 */

export type StudyPhase =
  | 'idle'
  | 'loading'
  | 'studying'
  | 'waiting'
  | 'finished'
  | 'empty'
  | 'error';

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
  /** waiting 相位：还有多少张临期卡（R-A1） */
  pendingCount: number;
  /** waiting 相位：最早到期时刻（R-A1）；无则 null */
  pendingDueAt: number | null;

  start: (mode: SessionMode) => Promise<void>;
  reveal: () => void;
  rate: (self: RatingInput['self']) => Promise<void>;
  skip: () => void;
  /** 队列推进后统一收尾判定：能继续 → studying；有临期卡 → waiting；真结束 → finish */
  settle: () => Promise<void>;
  /** 从 waiting 继续：倒计时到点自动续（force=false）/ 用户「立即继续」强制续（force=true） */
  resume: (force?: boolean) => Promise<void>;
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
  pendingCount: 0,
  pendingDueAt: null as number | null,
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
        // R-A1：队列为空时先查临期卡——有 → waiting（并非今日完成），无 → empty
        const now = Date.now();
        const soon = await peekDueSoon(now, REQUEUE_WINDOW_MS);
        if (soon.count > 0 && soon.earliestDueAt !== null) {
          set({
            ...INITIAL,
            phase: 'waiting',
            mode,
            pendingCount: soon.count,
            pendingDueAt: soon.earliestDueAt,
          });
          return;
        }
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
        pendingCount: 0,
        pendingDueAt: null,
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

      // Again 重现：携带 notBefore（= 该卡 due）追加；同词已在待答区则原地更新（R-A2）
      const nextQueue = [...state.queue];
      if (result.requeuedSameDay) {
        const wid = item.word.id;
        const pendingIdx = nextQueue.findIndex((q, i) => i > state.cursor && q.word.id === wid);
        const requeued: StudyItem = {
          ...item,
          card: result.card,
          isNew: false,
          notBefore: result.card.due,
        };
        if (pendingIdx >= 0) nextQueue[pendingIdx] = requeued;
        else nextQueue.push(requeued);
      }
      set({
        queue: nextQueue,
        cursor: state.cursor + 1,
        revealed: false,
        rated: state.rated + 1,
        shownAt: now,
      });
      await get().settle();
    } catch (error) {
      set({ phase: 'error', error: describeError(error) });
    }
  },

  skip: (): void => {
    const state = get();
    if (state.phase !== 'studying') return;
    set({ cursor: state.cursor + 1, revealed: false, shownAt: Date.now() });
    void get().settle();
  },

  settle: async (): Promise<void> => {
    const state = get();
    const now = Date.now();
    if (state.cursor < state.queue.length) {
      // 队内仍有未展示的项：若全部被 notBefore 门控 → waiting，否则继续
      const held = state.queue.slice(state.cursor).filter((it) => (it.notBefore ?? 0) > now);
      if (held.length > 0) {
        set({
          phase: 'waiting',
          pendingCount: held.length,
          pendingDueAt: held[0]?.notBefore ?? now,
        });
        return;
      }
      set({ phase: 'studying' });
      return;
    }
    // 队列已耗尽：查临期卡，避免静默误判「今日完成」（R-A1 安全网）
    try {
      const soon = await peekDueSoon(now, REQUEUE_WINDOW_MS);
      if (soon.count > 0 && soon.earliestDueAt !== null) {
        set({ phase: 'waiting', pendingCount: soon.count, pendingDueAt: soon.earliestDueAt });
        return;
      }
      await get().finish();
    } catch (error) {
      set({ phase: 'error', error: describeError(error) });
    }
  },

  resume: async (force = false): Promise<void> => {
    const state = get();
    const now = Date.now();
    if (!force && state.pendingDueAt !== null && now < state.pendingDueAt) return;
    const cur = state.queue[state.cursor];
    if (cur) {
      set({ phase: 'studying', pendingCount: 0, pendingDueAt: null, revealed: false, shownAt: now });
      return;
    }
    // 队内已无待答项（waiting 由「库中临期卡」触发）→ 重开一组
    await get().start(state.mode);
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
