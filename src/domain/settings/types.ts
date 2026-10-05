import type { Tier } from '@/domain/word/types';

/** 词频档位筛选（'all' = 不按档位过滤） */
export type TierFilter = Tier | 'all';

/**
 * 出词顺序（替代旧的布尔量 `freqOrdering`）。
 *
 * - `random` 随机：在候选集内洗牌，**默认档** —— 用户明确要求「不要从头开始，想要随机点」
 * - `freq`  词频：严格按 freqRank 升序（rank 越小 = 真卷出现越多）
 * - `weak`  未掌握优先：稳定性低 / 遗忘次数多的卡排前面
 * - `wrong` 错词优先：错题本里的词排前面
 */
export type StudyOrder = 'random' | 'freq' | 'weak' | 'wrong';

export const STUDY_ORDER_VALUES: readonly StudyOrder[] = ['random', 'freq', 'weak', 'wrong'];

export const STUDY_ORDER_LABEL: Record<StudyOrder, string> = {
  random: '随机',
  freq: '词频',
  weak: '未掌握优先',
  wrong: '错词优先',
};

export const STUDY_ORDER_HINT: Record<StudyOrder, string> = {
  random: '在候选词里随机抽，不会每天从同一批开头词开始',
  freq: '先学真卷里出现次数最多的词（rank 越小越前）',
  weak: '记忆稳定性低、忘过多次的卡先出现',
  wrong: '错题本里记过的词先出现',
};

export function isStudyOrder(value: unknown): value is StudyOrder {
  return typeof value === 'string' && (STUDY_ORDER_VALUES as readonly string[]).includes(value);
}

/**
 * AI 批改配置（★ 只存 `keyId` 引用，**绝不存明文 API Key**）。
 *
 * 明文 Key 存 Dexie `secrets` 表（属 `SECRET_STORES`），与 `PROGRESS_STORES` 不相交，
 * 因此导出备份**结构上不可能**带走密钥（见 docs/04b §5.14.2 / §5.14.8）。
 */
export interface AiConfig {
  /** 关闭时零网络请求（铁律 A2） */
  enabled: boolean;
  /** OpenAI 兼容端点，必须是 https://（http 明文一律拒绝） */
  baseUrl: string;
  /** 模型名，用户自填（厂商迭代快，硬编码即过期） */
  model: string;
  /** 整体超时 ms，默认 15000 */
  timeoutMs: number;
  /** ★ 只是引用，不是明文。固定为 'llm.apiKey' */
  keyId?: string;
}

/** 默认 AI 配置（全部留空 + 关闭，用户自填才生效） */
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  baseUrl: '',
  model: '',
  timeoutMs: 15000,
};

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
  /** 出词顺序，默认 'random'（见 StudyOrder 注释） */
  studyOrder: StudyOrder;
  /**
   * @deprecated v1 遗留的布尔开关，v2 起**只读不写**（回滚影子字段）。
   * 所有读路径一律用 `studyOrder`；保留它是为了万一线上回退到 v1 代码，
   * 老代码仍能还原用户当初的选择。
   */
  freqOrdering?: boolean;
  /** 【MVP 恒为 false】C3 约束 */
  aiEnabled: boolean;
  /** AI 批改配置（★ 不含明文 Key，只有 keyId 引用） */
  aiConfig: AiConfig;
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

export const SETTINGS_SCHEMA_VERSION = 2;

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
  // ★ 默认是「随机」：用户明确要求不要每次都从同一批开头词开始
  studyOrder: 'random',
  aiEnabled: false,
  aiConfig: { ...DEFAULT_AI_CONFIG },
  prefetchEnabled: true,
  audioBaseUrl: undefined,
  mockStrictTiming: true,
  paperSourcePreference: 'builtin',
};

/**
 * 用默认值兜底合并出一份完整设置（脏数据 / 缺字段时也能工作），**并做版本迁移**。
 *
 * ★ v1 → v2 迁移：`freqOrdering`（布尔）→ `studyOrder`（枚举）
 *   - `freqOrdering: true`  → `studyOrder: 'freq'`   （用户当初明确要词频）
 *   - `freqOrdering: false` → `studyOrder: 'random'` （用户当初明确要随机）
 *   - 两者都没有（全新用户）→ 取默认值 `'random'`
 *   ★ `freqOrdering` 原值**保留不动**，作为回滚影子字段（v2 及以后所有读路径都不读它）。
 */
export function mergeSettings(partial: Partial<UserSettings> | null | undefined): UserSettings {
  if (!partial) return { ...DEFAULT_SETTINGS };

  const draft: UserSettings = { ...DEFAULT_SETTINGS, ...partial };
  draft.schemaVersion = SETTINGS_SCHEMA_VERSION;

  // ★ 判据必须看**入参**有没有合法 studyOrder，不能看合并后的 draft ——
  //   draft 已被默认值填成 'random'，用它判断会把 v1 老数据误认成 v2，迁移永远不触发。
  if (!isStudyOrder(partial.studyOrder)) {
    // v1 老数据 / 脏数据：靠 freqOrdering 还原语义，都没有则取当前默认
    if (partial.freqOrdering === true) draft.studyOrder = 'freq';
    else if (partial.freqOrdering === false) draft.studyOrder = 'random';
    else draft.studyOrder = DEFAULT_SETTINGS.studyOrder;
  }

  // ★ aiConfig 是 v2 才加的对象字段：老备份里根本没有，必须逐字段兜底，
  //   否则 `aiConfig.timeoutMs` 会是 undefined，LLM 超时逻辑直接失效。
  const rawAi = partial.aiConfig;
  draft.aiConfig = rawAi && typeof rawAi === 'object'
    ? { ...DEFAULT_AI_CONFIG, ...rawAi }
    : { ...DEFAULT_AI_CONFIG };

  return draft;
}

/** `mergeSettings` 的迁移语义别名 —— 语义更明确，调用点可任选其一 */
export const migrateSettings = mergeSettings;
