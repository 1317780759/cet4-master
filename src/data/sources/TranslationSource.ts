import type { TranslationItem, TranslationTopicKey } from '@/domain/translation/types';

/**
 * 翻译训练数据读取接口。
 *
 * ★ 与 `PaperSource` 同构：UI 层只依赖接口，**禁止直接 fetch JSON**。
 *   将来若要把语料换成 LLM 生成 / 用户导入，只需换一个实现，UI 一行不用改。
 *
 * ★ 本文件**只有类型与路径常量，零实现、零 fetch** ——
 *   实现在 `StaticJsonTranslationSource.ts`。目的是让"契约"可被 UI/服务层单独 import，
 *   不会顺带把 fetch 拉进依赖图（领域层与 UI 层因此保持零 IO）。
 */

/** translations/index.json 的形状 */
export interface TranslationsIndexFile {
  version: string;
  /** 话题目录；顺序 = UI 展示顺序（构建时按 TRANSLATION_TOPIC_KEYS 排好） */
  topics: Array<{ key: TranslationTopicKey; label: string; count: number }>;
}

/** translations/<topicKey>.json 的形状 */
export interface TranslationTopicFileShape {
  topic: TranslationTopicKey;
  label: string;
  items: TranslationItem[];
}

export interface TranslationSource {
  /** 'static-json-translation' 等 */
  readonly id: string;

  /** 读话题目录（轻量，首屏可安全调用） */
  loadIndex(): Promise<TranslationsIndexFile>;

  /** 按话题懒加载全部句子 */
  loadTopic(topic: TranslationTopicKey): Promise<TranslationTopicFileShape>;
}

/**
 * 产物路径常量。
 *
 * ★ 与 `BuiltinPaperSource` 同写法：**不带 leading slash**，
 *   由 `dataBaseUrl()` 拼出完整 URL —— 它已处理 GH Pages 子路径部署
 *   （`import.meta.env.BASE_URL`，本地为 `/`，子路径部署为 `/<repo>/`）。
 */
export const TRANSLATIONS_INDEX_FILE = 'translations/index.json';

/** 单话题产物路径（topic 经校验后才允许拼 URL，避免拼出越界路径） */
export function translationsTopicFile(topic: TranslationTopicKey): string {
  return `translations/${encodeURIComponent(topic)}.json`;
}
