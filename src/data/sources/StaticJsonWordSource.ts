import type { Word, WordIndexRow } from '@/domain/word/types';
import type { AttributionInfo, DataManifest, WordChunkFile, WordIndexFile } from '@/data/types';
import { dataBaseUrl, fetchManifest, fetchTextWithBytes, verifySha256 } from '@/data/loader/manifest';
import type { WordSource } from './WordSource';

/** 索引 / 分片文件名模板 */
const CORE_INDEX_FILE = 'words.index.core.json';
const FULL_INDEX_FILE = 'words.index.full.json';

/**
 * 默认实现：读 `public/data/` 下的静态 JSON 分片。
 *
 * ★ 铁律 A2/A3：这是全站**唯一**允许发数据请求的地方之一；
 * UI 层与服务层必须通过 `WordSource` 接口访问，不得直接 fetch JSON。
 */
export class StaticJsonWordSource implements WordSource {
  readonly id = 'static-json';

  attribution: AttributionInfo;

  private readonly baseUrl: string;

  private manifest: DataManifest | null = null;

  constructor(baseUrl: string = dataBaseUrl(), attribution?: AttributionInfo) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.attribution = attribution ?? FALLBACK_ATTRIBUTION;
  }

  async fetchManifest(): Promise<DataManifest> {
    const manifest = await fetchManifest(this.baseUrl);
    this.manifest = manifest;
    // manifest 自带权威溯源信息，覆盖构造时的兜底值
    this.attribution = manifest.attribution ?? this.attribution;
    return manifest;
  }

  async fetchCoreIndex(): Promise<WordIndexRow[]> {
    const manifest = await this.ensureManifest();
    const url = `${this.baseUrl}${CORE_INDEX_FILE}`;
    const { text, bytes } = await fetchTextWithBytes(url);
    const ok = await verifySha256(bytes, manifest.indexes.core.sha256);
    if (!ok) {
      throw new Error(`words.index.core.json 校验失败（sha256 不匹配）`);
    }
    const parsed = JSON.parse(text) as WordIndexFile;
    return parsed.rows;
  }

  async fetchFullIndex(): Promise<WordIndexRow[]> {
    const manifest = await this.ensureManifest();
    const url = `${this.baseUrl}${FULL_INDEX_FILE}`;
    const { text, bytes } = await fetchTextWithBytes(url);
    const ok = await verifySha256(bytes, manifest.indexes.full.sha256);
    if (!ok) {
      throw new Error(`words.index.full.json 校验失败（sha256 不匹配）`);
    }
    const parsed = JSON.parse(text) as WordIndexFile;
    return parsed.rows;
  }

  async fetchChunk(chunkIndex: number): Promise<Word[]> {
    const manifest = await this.ensureManifest();
    const meta = manifest.chunks.find((c) => c.index === chunkIndex);
    if (!meta) {
      throw new Error(`分片不存在：chunk-${chunkIndex}（manifest 共 ${manifest.chunks.length} 片）`);
    }
    const url = `${this.baseUrl}${meta.file}`;
    const { text, bytes } = await fetchTextWithBytes(url);
    const ok = await verifySha256(bytes, meta.sha256);
    if (!ok) {
      throw new Error(`${meta.file} 校验失败（sha256 不匹配）`);
    }
    const parsed = JSON.parse(text) as WordChunkFile;
    return parsed.words;
  }

  chunkCount(): number | null {
    return this.manifest?.chunkCount ?? null;
  }

  /** 已缓存的 manifest（避免重复请求） */
  peekManifest(): DataManifest | null {
    return this.manifest;
  }

  /** 注入已知 manifest：省掉一次 manifest 请求（单测 / 服务端预渲染场景） */
  primeManifest(manifest: DataManifest): void {
    this.manifest = manifest;
    this.attribution = manifest.attribution ?? this.attribution;
  }

  private async ensureManifest(): Promise<DataManifest> {
    if (this.manifest) return this.manifest;
    return this.fetchManifest();
  }
}

/** manifest 尚未加载时的兜底溯源信息（真实值由 manifest.attribution 覆盖） */
const FALLBACK_ATTRIBUTION: AttributionInfo = {
  sourceId: 'exam-data/CETVocabulary',
  name: '四六级词汇词频排序数据（exam-data/CETVocabulary）',
  url: 'https://github.com/exam-data/CETVocabulary',
  license: 'CC BY-NC-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  commercialUse: false,
  fetchedAt: '',
  upstreamRef: 'main',
};

/** 供单测复用：直接用已知 manifest 构造 source，省掉一次 manifest 请求 */
export function createStaticSourceWithManifest(
  manifest: DataManifest,
  baseUrl?: string,
): StaticJsonWordSource {
  const source = new StaticJsonWordSource(baseUrl);
  source.primeManifest(manifest);
  return source;
}
