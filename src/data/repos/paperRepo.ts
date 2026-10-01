import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { ExamPaper, ExamQuestion, ExamSection } from '@/domain/exam/types';
import type { PaperBundle, PaperSummary } from '@/data/sources/PaperSource';

/**
 * 套卷仓库 —— 按套懒加载，用过的才入库（sections / questions 随用随长）。
 * 与 `BuiltinPaperSource` 通过 `PaperBundle` 同构（铁律 A4）。
 */

/** 落库一套卷（paper + sections + questions 一次事务） */
export async function putPaperBundle(
  bundle: PaperBundle,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  await instance.transaction('rw', [instance.papers, instance.sections, instance.questions], async () => {
    await instance.papers.put(bundle.paper);
    if (bundle.sections.length > 0) {
      await instance.sections.bulkPut(bundle.sections);
    }
    if (bundle.questions.length > 0) {
      await instance.questions.bulkPut(bundle.questions);
    }
  });
}

export async function getPaper(
  paperId: string,
  instance: Cet4Database = defaultDb,
): Promise<ExamPaper | undefined> {
  return instance.papers.get(paperId);
}

/** 已缓存的套卷列表（本地镜像，非远端目录） */
export async function listPapers(instance: Cet4Database = defaultDb): Promise<ExamPaper[]> {
  return instance.papers.orderBy('id').toArray();
}

/** 把远端目录条目与本地已缓存状态合并（UI 展示"已下载/未下载"） */
export async function mergeWithCached(
  summaries: readonly PaperSummary[],
  instance: Cet4Database = defaultDb,
): Promise<Array<PaperSummary & { cached: boolean }>> {
  const cachedIds = new Set((await listPapers(instance)).map((p) => p.id));
  return summaries.map((s) => ({ ...s, cached: cachedIds.has(s.id) }));
}

export async function listSections(
  paperId: string,
  instance: Cet4Database = defaultDb,
): Promise<ExamSection[]> {
  return instance.sections.where('paperId').equals(paperId).sortBy('order');
}

export async function listQuestions(
  paperId: string,
  instance: Cet4Database = defaultDb,
): Promise<ExamQuestion[]> {
  return instance.questions.where('paperId').equals(paperId).sortBy('no');
}

export async function countQuestions(
  paperId: string,
  instance: Cet4Database = defaultDb,
): Promise<number> {
  return instance.questions.where('paperId').equals(paperId).count();
}

/** 判断某套卷是否已在本地缓存（避免重复 fetch） */
export async function isPaperCached(
  paperId: string,
  instance: Cet4Database = defaultDb,
): Promise<boolean> {
  return (await instance.papers.get(paperId)) !== undefined;
}
