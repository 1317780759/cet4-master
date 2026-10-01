import type { Tier } from '@/domain/word/types';

/** 词频档位筛选（'all' = 不按档位过滤） */
export type TierFilter = Tier | 'all';

/**
 * 用户设置 —— 存在 IndexedDB.meta['settings']，永不随词库升级被清空。
 * 形状与实现方案 3.4 `UserSettings` 完全一致。
 */
export interface UserSettings {
  /** 设置结构版本，用于将来字段迁移 */
  schemaVersion: number;
  /** 每日新词量，默认 20 */
  dailyGoal: number;
  /** 每日复习上限，默认 200（防雪崩） */
  reviewLimit: number;
  /** 词频档位筛选 */
  tier: TierFilter;
  accent: 'uk' | 'us';
  theme: 'light' | 'dark' | 'system';
  /** 自动发音（受浏览器手势解锁限制） */
  autoPlay: boolean;
  ttsProvider: 'youdao' | 'webspeech' | 'off';
  /** R20 偷看扣分开关 */
  peekPenalty: boolean;
  /** true=词频降序(默认) / false=随机 */
  freqOrdering: boolean;
  /** 【MVP 恒为 false】C3 约束 */
  aiEnabled: boolean;
  /** 后台预取后续分片 */
  prefetchEnabled: boolean;

  // —— v1.1：真题与音频 ——
  /** 用户自备音频源地址；为空则 audio-index.defaultMissing 生效 → TTS 降级 */
  audioBaseUrl?: string;
  /** 模考模式：严格 125 分钟 / 练习模式不限时可跳板块 */
  mockStrictTiming: boolean;
  /** 套卷来源偏好 */
  paperSourcePreference: 'builtin' | 'user-import';
}

export const SETTINGS_SCHEMA_VERSION = 1;

/** 默认设置 —— 新增字段必须在此给出默认值，保证老用户升级不炸 */
export const DEFAULT_SETTINGS: UserSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  dailyGoal: 20,
  reviewLimit: 200,
  tier: 'core2104',
  accent: 'us',
  theme: 'system',
  autoPlay: true,
  ttsProvider: 'webspeech',
  peekPenalty: true,
  freqOrdering: true,
  aiEnabled: false,
  prefetchEnabled: true,
  audioBaseUrl: undefined,
  mockStrictTiming: true,
  paperSourcePreference: 'builtin',
};

/** 用默认值兜底合并出一份完整设置（脏数据 / 缺字段时也能工作） */
export function mergeSettings(partial: Partial<UserSettings> | null | undefined): UserSettings {
  if (!partial) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...partial, schemaVersion: SETTINGS_SCHEMA_VERSION };
}
