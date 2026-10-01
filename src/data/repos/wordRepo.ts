import { db as defaultDb, MIRROR_STORES, type Cet4Database } from '@/data/db/db';
import type { Word, WordIndexRow } from '@/domain/word/types';

/** meta 表的键（系统区） */
export const META_DATA_VERSION = 'dataVersion';
export const META_MANIFEST_AT = 'manifestGeneratedAt';
export const META_CORE_INDEX = 'wordIndex.core';
export const META_LOADED_CHUNKS = 'wordIndex.loadedChunks';
export const META_LAST_BACKUP_AT = 'lastBackupAt';

/** 读 meta */
export async function getMeta<T>(key: string, instance: Cet4Database = defaultDb): Promise<T | null> {
  const row = await instance.meta.get(key);
  if (!row) return null;
  return (row.value as T | null) ?? null;
}

/** 写 meta */
export async function setMeta<T>(
  key: string,
  value: T,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  await instance.meta.put({ key, value });
}

/** 词库总条数 */
export async function countWords(instance: Cet4Database = defaultDb): Promise<number> {
  return instance.words.count();
}

/**
 * 清空**只读镜像区**。
 * ★ 只清 MIRROR_STORES，绝不动 cards/wrongBook 等用户进度表 —— 换数据源不伤进度。
 */
export async function clearMirror(instance: Cet4Database = defaultDb): Promise<string[]> {
  const cleared: string[] = [];
  await instance.transaction('rw', [...MIRROR_STORES], async () => {
    for (const name of MIRROR_STORES) {
      await instance.table(name).clear();
      cleared.push(name);
    }
  });
  await setMeta(META_LOADED_CHUNKS, [], instance);
  await setMeta(META_CORE_INDEX, [], instance);
  return cleared;
}

/** 批量写入词条（覆盖式，用于分片灌库） */
export async function bulkPutWords(
  words: readonly Word[],
  instance: Cet4Database = defaultDb,
): Promise<number> {
  if (words.length === 0) return 0;
  await instance.words.bulkPut(words as Word[]);
  return words.length;
}

/** 按主键取词 */
export async function getWord(
  id: string,
  instance: Cet4Database = defaultDb,
): Promise<Word | undefined> {
  return instance.words.get(id);
}

/** 按主键批量取词（不存在的 id 会被过滤掉） */
export async function getWords(
  ids: readonly string[],
  instance: Cet4Database = defaultDb,
): Promise<Word[]> {
  if (ids.length === 0) return [];
  const rows = await instance.words.bulkGet([...ids]);
  return rows.filter((row): row is Word => row !== undefined);
}

/** 按词频区间取词（freqRank 升序 = 词频降序） */
export async function getWordsByRank(
  from: number,
  to: number,
  instance: Cet4Database = defaultDb,
): Promise<Word[]> {
  return instance.words.where('freqRank').between(from, to, true, true).sortBy('freqRank');
}

/** 分页取词（按 freqRank 升序） */
export async function getWordsPage(
  offset: number,
  limit: number,
  instance: Cet4Database = defaultDb,
): Promise<Word[]> {
  return instance.words.orderBy('freqRank').offset(offset).limit(limit).toArray();
}

/** 按前缀搜词（headword 索引） */
export async function searchByHeadword(
  prefix: string,
  limit = 20,
  instance: Cet4Database = defaultDb,
): Promise<Word[]> {
  const key = prefix.trim().toLowerCase();
  if (!key) return [];
  return instance.words.where('headword').startsWithIgnoreCase(key).limit(limit).toArray();
}

/** 保存 / 读取轻量索引（首屏构建学习队列用） */
export async function saveCoreIndex(
  rows: readonly WordIndexRow[],
  instance: Cet4Database = defaultDb,
): Promise<void> {
  await setMeta(META_CORE_INDEX, rows, instance);
}

export async function loadCoreIndex(
  instance: Cet4Database = defaultDb,
): Promise<WordIndexRow[]> {
  return (await getMeta<WordIndexRow[]>(META_CORE_INDEX, instance)) ?? [];
}

/** 记录已加载的分片 */
export async function markChunkLoaded(
  chunkIndex: number,
  instance: Cet4Database = defaultDb,
): Promise<number[]> {
  const current = (await getMeta<number[]>(META_LOADED_CHUNKS, instance)) ?? [];
  if (current.includes(chunkIndex)) return current;
  const next = [...current, chunkIndex].sort((a, b) => a - b);
  await setMeta(META_LOADED_CHUNKS, next, instance);
  return next;
}

/** 已加载的分片列表 */
export async function loadedChunks(instance: Cet4Database = defaultDb): Promise<number[]> {
  return (await getMeta<number[]>(META_LOADED_CHUNKS, instance)) ?? [];
}

/** 某分片是否已入库 */
export async function isChunkLoaded(
  chunkIndex: number,
  instance: Cet4Database = defaultDb,
): Promise<boolean> {
  return (await loadedChunks(instance)).includes(chunkIndex);
}

/** 本地数据版本（启动自检比对用） */
export async function localDataVersion(instance: Cet4Database = defaultDb): Promise<string | null> {
  return getMeta<string>(META_DATA_VERSION, instance);
}

/** 按 tier 统计条数（Dashboard 展示用） */
export async function countByTier(
  instance: Cet4Database = defaultDb,
): Promise<Record<'core2104' | 'cet4' | 'extended', number>> {
  const [core2104, cet4, extended] = await Promise.all([
    instance.words.where('tier').equals('core2104').count(),
    instance.words.where('tier').equals('cet4').count(),
    instance.words.where('tier').equals('extended').count(),
  ]);
  return { core2104, cet4, extended };
}
