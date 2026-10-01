/**
 * SRS / 复习域类型 —— 铁律 A1：纯类型 + 纯常量，零 React / 零 IO。
 *
 * M0 只落地「类型」部分，供 Dexie `cards` 表与 `cardRepo` 使用；
 * scheduler / adapter / rating-map 的实现属于 M1，不在本轮范围。
 */

/** ts-fsrs Rating: 1=Again 2=Hard 3=Good 4=Easy */
export type FsrsRating = 1 | 2 | 3 | 4;

/** 全部合法评级（不含 Manual=0），用于遍历 / 预览 / 校验 */
export const RATING_VALUES: readonly FsrsRating[] = [1, 2, 3, 4];

/** 评级的中文展示名 */
export const RATING_LABEL: Record<FsrsRating, string> = {
  1: '不认识',
  2: '模糊',
  3: '认识',
  4: '太简单',
};

/** 三级自评的中文展示名（R02） */
export const SELF_LABEL: Record<RatingInput['self'], string> = {
  known: '认识',
  fuzzy: '模糊',
  unknown: '不认识',
};

/** ts-fsrs State: 0=New 1=Learning 2=Review 3=Relearning */
export type FsrsState = 0 | 1 | 2 | 3 | 4;

/**
 * 复习卡片 —— 用户进度的核心表。
 * 字段名刻意与 ts-fsrs 的 Card 对齐，但把 Date 换成 number(epoch ms)，
 * 由 domain/fsrs/adapter.ts 做双向映射（Date 无法直接存 IndexedDB 做索引排序）。
 */
export interface ReviewCard {
  /** 【主键】与 Word.id 一致 */
  wordId: string;
  /** epoch ms —— 主查询索引 */
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: FsrsState;
  /** epoch ms */
  lastReview?: number;
  /** 已掌握 / 手动移出队列（R07） */
  suspended: boolean;
  createdAt: number;
  /** 引入时的 freqRank，用于「高频词覆盖率」统计（G1） */
  introsRank: number;
  /**
   * ts-fsrs 学习步骤游标（对齐 `Card.learning_steps`）。
   * ★ M1 补入：ts-fsrs 的短时调度（Learning / Relearning 阶段）读该字段决定
   * 停留在第几个 learning step。若不持久化，Learning 卡片会在每次读盘后被重置，
   * 永远无法推进到 Review 阶段（详见 adapter.ts 注释与单测）。
   * 设为可选以兼容 M0 已落库的旧卡片 —— 缺省按 0 处理。
   */
  learningSteps?: number;
}

/** MVP 三级自评 → FSRS 四分评级的映射表（含 R20「偷看详情扣分」） */
export interface RatingInput {
  /** R02 三级自评 */
  self: 'known' | 'fuzzy' | 'unknown';
  /** 是否查看过详情（释义/例句） */
  peeked: boolean;
  /** 作答耗时 */
  elapsedMs: number;
}

/** key = `${self}-${peeked ? 'peek' : 'clean'}` */
export const RATING_MAP: Record<string, FsrsRating> = {
  'known-clean': 4,
  'known-peek': 3,
  'fuzzy-clean': 3,
  'fuzzy-peek': 2,
  'unknown-clean': 1,
  'unknown-peek': 1,
};

/** 犹豫降级阈值：自评「认识」但耗时超过 8 秒 → 降级为 Good */
export const HESITATION_MS = 8000;

/** 新建一张卡片（FSRS 初始状态） */
export function createCard(wordId: string, freqRank: number, now: number): ReviewCard {
  return {
    wordId,
    due: now,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    suspended: false,
    createdAt: now,
    introsRank: freqRank,
    learningSteps: 0,
  };
}

/** FSRS 状态的中文展示名（UI 用，纯常量） */
export const FSRS_STATE_LABEL: Record<FsrsState, string> = {
  0: '新词',
  1: '学习中',
  2: '复习中',
  3: '重学中',
  4: '未知',
};
