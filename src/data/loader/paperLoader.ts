import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { PaperBundle, PaperSource } from '@/data/sources/PaperSource';
import {
  countQuestions,
  getPaper,
  isPaperCached,
  listQuestions,
  listSections,
  putPaperBundle,
} from '@/data/repos/paperRepo';

/**
 * 套卷加载器骨架（M0）。
 *
 * ★ 铁律 A4：只依赖 `PaperSource` 接口，不关心卷是内置的还是用户导入的。
 * ★ 按套懒加载：进入某套才 fetch 该套完整 JSON，**绝不预取全部套卷**。
 * M2 将在此之上补：进度、断点续考、与 AudioIndex 的联动。
 */

export interface LoadPaperResult {
  bundle: PaperBundle;
  /** true = 命中本地缓存，未发请求 */
  fromCache: boolean;
}

/** 取一套卷：本地有缓存就用缓存，没有才走 PaperSource */
export async function ensurePaper(
  paperId: string,
  source: PaperSource,
  instance: Cet4Database = defaultDb,
): Promise<LoadPaperResult> {
  if (await isPaperCached(paperId, instance)) {
    const paper = await getPaper(paperId, instance);
    if (paper) {
      const [sections, questions] = await Promise.all([
        listSections(paperId, instance),
        listQuestions(paperId, instance),
      ]);
      return { bundle: { paper, sections, questions }, fromCache: true };
    }
  }

  const bundle = await source.loadPaper(paperId);
  await putPaperBundle(bundle, instance);
  return { bundle, fromCache: false };
}

/** 本地是否已有该套卷（UI 展示"已下载"角标） */
export async function hasPaper(
  paperId: string,
  instance: Cet4Database = defaultDb,
): Promise<boolean> {
  return isPaperCached(paperId, instance);
}

/** 本地缓存的题量（用于与目录声明的 questionCount 对账） */
export async function cachedQuestionCount(
  paperId: string,
  instance: Cet4Database = defaultDb,
): Promise<number> {
  return countQuestions(paperId, instance);
}
