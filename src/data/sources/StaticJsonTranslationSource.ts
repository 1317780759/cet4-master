import type { TranslationTopicKey } from '@/domain/translation/types';
import { TRANSLATION_TOPIC_KEYS, isTranslationTopicKey } from '@/domain/translation/topics';
import { dataBaseUrl, fetchJson } from '@/data/loader/manifest';
import type {
  TranslationSource,
  TranslationsIndexFile,
  TranslationTopicFileShape,
} from './TranslationSource';
import { TRANSLATIONS_INDEX_FILE, translationsTopicFile } from './TranslationSource';

/**
 * 默认实现：读 `public/data/translations/*.json`（静态 JSON，运行时 fetch）。
 *
 * ★ 与 `BuiltinPaperSource` 同纪律：
 *   - data 路径由 `dataBaseUrl()` 拼出，**不进 JS bundle**、**不带 leading slash**；
 *   - 话题目录与话题内容都做**内存缓存** —— 翻译页会在话题间来回切换，
 *     不缓存的话每次切回去都会重发一次请求，白耗流量并造成列表闪烁。
 */
export class StaticJsonTranslationSource implements TranslationSource {
  readonly id = 'static-json-translation';

  private readonly baseUrl: string;

  private index: TranslationsIndexFile | null = null;

  private readonly topics = new Map<TranslationTopicKey, TranslationTopicFileShape>();

  constructor(baseUrl: string = dataBaseUrl()) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  async loadIndex(): Promise<TranslationsIndexFile> {
    if (this.index) return this.index;
    const index = await fetchJson<TranslationsIndexFile>(`${this.baseUrl}${TRANSLATIONS_INDEX_FILE}`);
    this.index = index;
    return index;
  }

  async loadTopic(topic: TranslationTopicKey): Promise<TranslationTopicFileShape> {
    assertTranslationTopicKey(topic);
    const cached = this.topics.get(topic);
    if (cached) return cached;

    const url = `${this.baseUrl}${translationsTopicFile(topic)}`;
    const file = await fetchJson<TranslationTopicFileShape>(url);
    if (!Array.isArray(file?.items)) {
      throw new Error(`话题产物格式异常（items 缺失）：${url}`);
    }
    // ★ 存缓存的是**归一化后**的对象：即使产物里混进多余字段，也不会渗进 UI
    const normalized: TranslationTopicFileShape = {
      topic,
      label: file.label ?? topic,
      items: file.items,
    };
    this.topics.set(topic, normalized);
    return normalized;
  }

  /** 已缓存的话题目录（避免为"只想知道有没有缓存"而发请求） */
  peekIndex(): TranslationsIndexFile | null {
    return this.index;
  }

  /** 清空内存缓存（切换数据源 / 单测 / 需要强制刷新时用） */
  clearCache(): void {
    this.index = null;
    this.topics.clear();
  }
}

/**
 * 运行时守卫：把来自 URL / 备份文件 / 老数据的 `string` 收敛成 `TranslationTopicKey`。
 *
 * ★ 抛错而不是静默回退 —— 话题 key 决定的是"去取哪个文件"，
 *   放行非法值会拼出越界路径（如 `../../x`），错误信息必须指明合法取值。
 */
export function assertTranslationTopicKey(topic: string): asserts topic is TranslationTopicKey {
  if (!isTranslationTopicKey(topic)) {
    throw new Error(
      `非法的话题 key："${topic}"。合法取值：${TRANSLATION_TOPIC_KEYS.join(', ')}`,
    );
  }
}
