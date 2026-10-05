/**
 * 翻译训练领域类型（铁律 A1：零 React / 零 IO / 零网络，可 100% 单测）。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.3（数据模型）、§5.4（评分器抽象）。
 *
 * ★ 本文件是翻译训练的**唯一类型契约**：
 *   - UI 层（V-14）**只能** `import type { TranslationScorer }`，禁止 import 实现模块；
 *   - `TranslationScorer` 是本期唯一扩展点，二期接入 LLM 批改时**无需改动本文件**。
 */

/** 参考档位 0–4（★ 仅供练习参考，绝不称为"四级官方评分"） */
export type Band = 0 | 1 | 2 | 3 | 4;

/** 15 个四级常考话题的 key（与 `topics.ts` 的 `TRANSLATION_TOPIC_KEYS` 一一对应） */
export type TranslationTopicKey =
  | 'trad-culture'
  | 'festival'
  | 'food'
  | 'economy'
  | 'tech'
  | 'health'
  | 'travel'
  | 'education'
  | 'environment'
  | 'urbanisation'
  | 'transport'
  | 'internet'
  | 'employment'
  | 'aging'
  | 'sports';

/** 话题（key + 中文标签） */
export interface TranslationTopic {
  key: TranslationTopicKey;
  /** 中文标签，直接给 UI 显示 */
  label: string;
}

/**
 * 得分点（人工标注，非自动生成）。
 *
 * 标注规范见 §5.10.3：`head` 必须是"批改一定会看"的核心词/搭配/句型，
 * 不得是冠词、介词、be 动词；每句 3–6 个。
 */
export interface KeyPoint {
  /** 同一 item 内唯一，如 `'kp1'` */
  id: string;
  /** ★ 必须命中的英文词/词组（小写规范形式）。多词词组用空格分词 */
  head: string;
  /** 对应中文，给用户看的提示文案（禁止写真题原句） */
  zh: string;
  /** 同近义词表（≤3），只列真正会被判同等层次的替换 */
  synonyms?: string[];
  /** 默认 1；核心搭配/句型可给 2 */
  weight?: number;
  /** 软得分点：命中加分，未命中按 0.5 权重计入分母（默认 false） */
  optional?: boolean;
}

/** 翻译题目（与 `src/data/db/rows.ts` 的 `TranslationRow` 同构，领域层去掉存储细节） */
export interface TranslationItem {
  id: string;
  topic: TranslationTopicKey;
  /** 1 易 / 2 中 / 3 难 */
  difficulty: 1 | 2 | 3;
  /** 中文题干（单句，15–40 汉字） */
  zh: string;
  /** 参考译文（教学用途自撰） */
  reference: string;
  /** 得分点 3–6 个 */
  keyPoints: KeyPoint[];
  /** 三级提示文本；缺省时由 keyPoints 自动生成 1 级 */
  hints?: string[];
  /** 话题词，供 UI 展示 / 一键查词 */
  topicWords?: string[];
  source: 'authored' | 'paper-derived';
  originPaperId?: string;
}

/** 评分请求 */
export interface ScoreRequest {
  /** 用户输入的英文译文 */
  text: string;
  keyPoints: readonly KeyPoint[];
}

/** 单个得分点的命中明细（UI 直接渲染 ✓/✗） */
export interface KeyPointHit {
  id: string;
  head: string;
  zh: string;
  hit: boolean;
  /** 命中时在**用户原文**中的字符区间（供高亮）；未命中为 null */
  span: [number, number] | null;
  /** 命中的实际词形（用户原文片段，可能是 head 的变形或同义词） */
  matchedAs?: string;
}

/** 评分结果 */
export interface ScoreResult {
  /** 得分点总数 */
  total: number;
  /** 命中数 */
  hit: number;
  /** 0..1（按 weight 加权） */
  ratio: number;
  /** 逐条明细，顺序与输入 keyPoints 一致 */
  points: KeyPointHit[];
  /** 参考档位 —— ★ 仅供参考，绝不称为"四级官方评分" */
  band: Band;
  /** 评分器自述；UI 用它显示来源标签（"离线评分" / "AI 批改"） */
  scoredBy: string;
}

/**
 * 落库用的精简评分快照（错句本 / 统计用）。
 * 与 `ScoreResult` 的区别：不含逐条明细，体积可控。
 */
export interface Score {
  hit: number;
  total: number;
  ratio: number;
  band: Band;
  scoredBy: string;
}

/**
 * 一次作答记录（领域层形态）。
 *
 * ★ `attemptedAt` 由调用方注入 —— 领域层不得出现 `Date.now()`（铁律 A1）。
 */
export interface TranslationAttempt {
  itemId: string;
  topic: TranslationTopicKey;
  /** 我的译文 */
  myText: string;
  score: Score;
  /** epoch ms，由调用方注入 */
  attemptedAt: number;
}

/** ★ UI 唯一依赖的评分器接口（异步签名，让二期 LLM 实现可流式 / 超时而无需改调用方） */
export interface TranslationScorer {
  readonly id: 'offline' | 'llm';
  readonly label: string;
  score(req: ScoreRequest): Promise<ScoreResult>;
}

/**
 * @since v2 —— 一期不启用，仅占位以保证将来无需再改 `UserSettings`。
 * ★ 明文 API Key，只存本机 IndexedDB；导出备份必须剔除。
 */
export interface LlmScorerConfig {
  /** OpenAI 兼容端点 */
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 默认 15000 */
  timeoutMs: number;
}
