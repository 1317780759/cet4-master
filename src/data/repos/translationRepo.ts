import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { TranslationBookRow } from '@/data/db/rows';
import type { TranslationItem, TranslationTopicKey } from '@/domain/translation/types';

/**
 * 翻译训练仓库 —— 只做 CRUD，不含任何业务算法（评分 / 选题留给 service 层）。
 *
 * 分两个区：
 * - `translations`        → 镜像区（MIRROR_STORES），由题库 JSON 灌入，可整体重建
 * - `translationBook`     → 进度区（PROGRESS_STORES），用户自己的错句，管线绝不碰
 *
 * 所有函数都接受可选 `instance`，单测可注入独立 Dexie 实例。
 */

/**
 * 清空翻译镜像。
 * 🔴 清理范围严格限定 `translations` **单表**，绝不使用 `clearMirror()` ——
 *    后者会连 words / papers 一起清掉，那是词库管线的事。
 */
export async function clearTranslations(instance: Cet4Database = defaultDb): Promise<void> {
  await instance.translations.clear();
}

/** 批量写入翻译条目（覆盖式，用于灌库） */
export async function mirrorTranslations(
  items: readonly TranslationItem[],
  instance: Cet4Database = defaultDb,
): Promise<number> {
  if (items.length === 0) return 0;
  await instance.translations.bulkPut(items as TranslationItem[]);
  return items.length;
}

/** 按话题取全部条目（topic 有索引） */
export async function listTranslationsByTopic(
  topic: TranslationTopicKey,
  instance: Cet4Database = defaultDb,
): Promise<TranslationItem[]> {
  return instance.translations.where('topic').equals(topic).toArray();
}

/** 按主键取单条 */
export async function getTranslation(
  id: string,
  instance: Cet4Database = defaultDb,
): Promise<TranslationItem | undefined> {
  return instance.translations.get(id);
}

/** 题库总条数（版本比对 / Dashboard 用） */
export async function countTranslations(instance: Cet4Database = defaultDb): Promise<number> {
  return instance.translations.count();
}

/**
 * 加入错句本。
 * - 带 `id` → upsert（覆盖）；
 * - 不带 `id` → 新增一行。
 * @returns 行主键
 */
export async function addTranslationBookRow(
  row: TranslationBookRow,
  instance: Cet4Database = defaultDb,
): Promise<number> {
  if (row.id !== undefined) {
    await instance.translationBook.put(row);
    return row.id;
  }
  return instance.translationBook.add(row);
}

/** 按 itemId 取错句本行 */
export async function findTranslationBookRow(
  itemId: string,
  instance: Cet4Database = defaultDb,
): Promise<TranslationBookRow | undefined> {
  return instance.translationBook.where('itemId').equals(itemId).first();
}

/** 移出错句本（itemId 不存在时静默返回） */
export async function removeTranslationBookRow(
  itemId: string,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  const row = await findTranslationBookRow(itemId, instance);
  if (row?.id === undefined) return;
  await instance.translationBook.delete(row.id);
}

/** 列出错句本（最近加入的在前） */
export async function listTranslationBook(
  instance: Cet4Database = defaultDb,
): Promise<TranslationBookRow[]> {
  return instance.translationBook.orderBy('addedAt').reverse().toArray();
}

/** 只列未归档的错句（重做队列用） */
export async function listUnresolvedTranslationBook(
  instance: Cet4Database = defaultDb,
): Promise<TranslationBookRow[]> {
  const rows = await listTranslationBook(instance);
  return rows.filter((row) => !row.resolved);
}

/** 归档 / 取消归档（连续答对后置 true） */
export async function markTranslationResolved(
  itemId: string,
  resolved: boolean,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  const row = await findTranslationBookRow(itemId, instance);
  if (row?.id === undefined) return;
  await instance.translationBook.put({ ...row, resolved });
}
