import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { TranslationItem } from '@/domain/translation/types';
import { getMeta, setMeta } from '@/data/repos/wordRepo';
import { clearTranslations, countTranslations, mirrorTranslations } from '@/data/repos/translationRepo';

/** meta 表的键（系统区）：已入库的翻译题库版本 */
export const META_TRANSLATIONS_VERSION = 'translationsVersion';

/**
 * 题库数据源的**结构化契约**（本地声明，不 import 具体实现模块）。
 *
 * ★ 刻意用本地接口而不是直接 import `TranslationSource` 类型：
 *   题库读取实现可由另一位同学并行开发，只要它满足这个形状就能直接塞进来，
 *   双方互不阻塞；将来真实 Source 天然满足该结构（鸭子类型）。
 */
export interface TranslationSourceLike {
  /** 读 `data/translations/index.json` */
  loadIndex(): Promise<{
    version: string;
    topics: Array<{ key: string; count: number }>;
  }>;
  /** 读 `data/translations/<topicKey>.json` */
  loadTopic(topic: string): Promise<{ items: TranslationItem[] }>;
}

export interface EnsureTranslationsResult {
  /** true = 本次真的灌了库；false = 版本一致，直接跳过 */
  loaded: boolean;
  /** 库中翻译条目总数 */
  count: number;
}

/**
 * 翻译题库入库（幂等）。
 *
 * 流程：读 index.version → 与 `meta['translationsVersion']` 比对
 *      → 不同才「清 translations **单表** + 逐话题 bulkPut + 写 meta」
 *      → 相同则直接返回现有行数，零网络 / 零写入。
 *
 * 🔴 清理范围严格限定 `translations` 单表：
 *    绝不使用 `clearMirror()`（会连 words/papers 一起清），
 *    更不会碰到 PROGRESS_STORES（用户进度）与 SECRET_STORES（明文凭据）。
 */
export async function ensureTranslationsLoaded(
  source: TranslationSourceLike,
  instance: Cet4Database = defaultDb,
): Promise<EnsureTranslationsResult> {
  const index = await source.loadIndex();
  const localVersion = await getMeta<string>(META_TRANSLATIONS_VERSION, instance);

  if (localVersion === index.version) {
    return { loaded: false, count: await countTranslations(instance) };
  }

  await clearTranslations(instance);

  let total = 0;
  for (const topic of index.topics) {
    const payload = await source.loadTopic(topic.key);
    if (payload.items.length === 0) continue;
    total += await mirrorTranslations(payload.items, instance);
  }

  await setMeta(META_TRANSLATIONS_VERSION, index.version, instance);
  return { loaded: true, count: total };
}

/** 已入库的题库版本（null = 从未灌过） */
export async function translationsVersion(
  instance: Cet4Database = defaultDb,
): Promise<string | null> {
  return getMeta<string>(META_TRANSLATIONS_VERSION, instance);
}
