import type { Word, WordIndexRow } from '@/domain/word/types';

/** 数据溯源于许可信息（C5 合规强制，落进 manifest 与 ATTRIBUTION.md） */
export interface AttributionInfo {
  /** 'exam-data/CETVocabulary' */
  sourceId: string;
  /** 展示用名称 */
  name: string;
  /** 数据源地址 */
  url: string;
  /** 'CC BY-NC-SA 4.0' */
  license: string;
  licenseUrl: string;
  /** 是否允许商用 —— 本数据源为 false */
  commercialUse: boolean;
  /** 抓取时间 ISO */
  fetchedAt: string;
  /** 上游版本锚点（commit sha / tag / 日期） */
  upstreamRef: string;
}

/** 单个分片的元信息 */
export interface ChunkMeta {
  /** 1-based */
  index: number;
  /** 'words/chunk-001.json' */
  file: string;
  /** 文件内容的 sha256（小写 hex） */
  sha256: string;
  count: number;
  bytes: number;
}

/** 索引文件元信息 */
export interface IndexMeta {
  file: string;
  sha256: string;
  count: number;
}

/**
 * 数据清单 —— 启动自检的唯一依据（≈1KB）。
 * 版本一致 → 跳过下载（第二次访问零词库请求）。
 */
export interface DataManifest {
  /** 数据版本，例：'2026.10.01' */
  version: string;
  /** ISO 时间戳 */
  generatedAt: string;
  /** 生成脚本标识 */
  generator: string;
  wordCount: number;
  coreCount: number;
  /** Top-N 边界（2104） */
  coreBoundary: number;
  chunkSize: number;
  chunkCount: number;
  /** 'words/chunk-{n}.json' */
  chunkFilePattern: string;
  indexes: {
    core: IndexMeta;
    full: IndexMeta;
  };
  chunks: ChunkMeta[];
  /** 例句管线（M1）；M0 恒为 unavailable，覆盖率 0 */
  sentences: {
    available: boolean;
    count: number;
    coverage: number;
    note: string;
  };
  attribution: AttributionInfo;
}

/** 分片文件（words/chunk-00n.json）的运行时形状 */
export interface WordChunkFile {
  chunk: number;
  count: number;
  words: Word[];
}

/** 索引文件（words.index.*.json）的运行时形状 */
export interface WordIndexFile {
  version: string;
  count: number;
  /** 列式行，字段极短以压缩体积 */
  rows: WordIndexRow[];
}
