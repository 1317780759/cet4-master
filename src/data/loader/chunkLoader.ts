import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { WordIndexRow } from '@/domain/word/types';
import type { WordSource } from '@/data/sources/WordSource';
import {
  bulkPutWords,
  clearMirror,
  countWords,
  getMeta,
  isChunkLoaded,
  loadCoreIndex,
  loadedChunks,
  localDataVersion,
  markChunkLoaded,
  META_DATA_VERSION,
  META_MANIFEST_AT,
  saveCoreIndex,
  setMeta,
} from '@/data/repos/wordRepo';

export type LoadPhase = 'idle' | 'manifest' | 'clean' | 'index' | 'chunk' | 'done';

export interface LoadProgress {
  phase: LoadPhase;
  message: string;
  /** 0..1 */
  ratio: number;
}

export interface EnsureWordbankResult {
  /**
   * true = 本地版本与 manifest 一致，**跳过全部词库下载**。
   * 这是「第二次访问零数据请求」的实现点。
   */
  skipped: boolean;
  version: string;
  wordCount: number;
  loadedChunks: number[];
}

export interface EnsureWordbankOptions {
  /** 进度回调 */
  onProgress?: (progress: LoadProgress) => void;
  /** 忽略本地版本强制重灌（设置页「重建词库」用） */
  force?: boolean;
}

const NO_PROGRESS: LoadProgress = { phase: 'idle', message: '等待中', ratio: 0 };

/**
 * 首屏数据保障：版本比对 →（不一致才）清镜像 → 灌索引 → 灌首片。
 *
 * ★ 只清 MIRROR_STORES，用户进度表（cards / wrongBook / …）分毫不动。
 * ★ 只下载「首片」，其余分片交给 cacheWarmer 在空闲时预取。
 */
export async function ensureWordbank(
  instance: Cet4Database = defaultDb,
  source: WordSource,
  options: EnsureWordbankOptions = {},
): Promise<EnsureWordbankResult> {
  const emit = options.onProgress ?? ((): void => undefined);

  emit({ phase: 'manifest', message: '正在检查数据版本', ratio: 0.05 });
  const manifest = await source.fetchManifest();
  const localVersion = await localDataVersion(instance);
  const localCount = await countWords(instance);
  const versionMatches = localVersion === manifest.version;

  if (!options.force && versionMatches && localCount >= manifest.wordCount) {
    emit({ phase: 'done', message: '数据已是最新', ratio: 1 });
    return {
      skipped: true,
      version: manifest.version,
      wordCount: localCount,
      loadedChunks: await loadedChunks(instance),
    };
  }

  emit({ phase: 'clean', message: '正在准备本地词库', ratio: 0.15 });
  // 版本不一致 → 清旧词库镜像（不动用户进度）
  await clearMirror(instance);

  emit({ phase: 'index', message: '正在加载高频词索引', ratio: 0.3 });
  const coreRows = await source.fetchCoreIndex();
  await saveCoreIndex(coreRows, instance);

  emit({ phase: 'chunk', message: '正在写入词库分片 1', ratio: 0.6 });
  await loadChunkIntoDb(instance, source, 1);

  await setMeta(META_DATA_VERSION, manifest.version, instance);
  await setMeta(META_MANIFEST_AT, manifest.generatedAt, instance);

  emit({ phase: 'done', message: '词库就绪', ratio: 1 });
  return {
    skipped: false,
    version: manifest.version,
    wordCount: await countWords(instance),
    loadedChunks: await loadedChunks(instance),
  };
}

/**
 * 下载单个分片并入库。
 * 幂等：已加载过的分片默认跳过（可由 force 覆盖）。
 */
export async function loadChunkIntoDb(
  instance: Cet4Database = defaultDb,
  source: WordSource,
  chunkIndex: number,
  force = false,
): Promise<number> {
  if (!force && (await isChunkLoaded(chunkIndex, instance))) {
    return 0;
  }
  const words = await source.fetchChunk(chunkIndex);
  await bulkPutWords(words, instance);
  await markChunkLoaded(chunkIndex, instance);
  return words.length;
}

/** 首屏需要的轻量索引（已缓存则直接返回，不再发请求） */
export async function ensureCoreIndex(
  instance: Cet4Database = defaultDb,
  source: WordSource,
): Promise<WordIndexRow[]> {
  const cached = await loadCoreIndex(instance);
  if (cached.length > 0) return cached;
  const rows = await source.fetchCoreIndex();
  await saveCoreIndex(rows, instance);
  return rows;
}

/** 启动自检摘要（Dashboard 展示 / 单测断言用） */
export async function inspectLocalData(instance: Cet4Database = defaultDb): Promise<{
  version: string | null;
  generatedAt: string | null;
  wordCount: number;
  indexRows: number;
  chunks: number[];
}> {
  const [version, generatedAt, wordCount, rows, chunks] = await Promise.all([
    localDataVersion(instance),
    getMeta<string>(META_MANIFEST_AT, instance),
    countWords(instance),
    loadCoreIndex(instance),
    loadedChunks(instance),
  ]);
  return { version, generatedAt, wordCount, indexRows: rows.length, chunks };
}

export { NO_PROGRESS };
