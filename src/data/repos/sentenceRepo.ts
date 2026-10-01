import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { ExamSentence } from '@/domain/exam/types';

/**
 * 真题例句仓库 —— 只读镜像区。
 *
 * ★ M1 范围说明（方案 R2）：M1 交付**例句渲染能力**（span 定位高亮、点击跳详情），
 *   但例句语料本身属 M2 数据工作（需跑真题抽取管线，涉及版权）。
 *   因此本轮 `public/data` 无例句分片，`manifest.sentences.available === false`，
 *   本仓库返回空数组，UI 必须优雅降级为「词频 + 释义」。
 *   绝不为了凑覆盖率而伪造例句。
 */

/** 某词的全部真题例句（按 paperId/questionNo 稳定排序） */
export async function listSentencesForWord(
  wordId: string,
  instance: Cet4Database = defaultDb,
): Promise<ExamSentence[]> {
  const rows = await instance.sentences.where('wordId').equals(wordId).toArray();
  return rows.sort((a, b) => {
    if (a.paperId !== b.paperId) return a.paperId < b.paperId ? -1 : 1;
    return (a.questionNo ?? 0) - (b.questionNo ?? 0);
  });
}

/** 批量取多词的例句（详情页 / 错题本用） */
export async function listSentencesForWords(
  wordIds: readonly string[],
  instance: Cet4Database = defaultDb,
): Promise<ExamSentence[]> {
  if (wordIds.length === 0) return [];
  const rows = await instance.sentences.where('wordId').anyOf([...wordIds]).toArray();
  return rows;
}

/** 例句总数（Dashboard / 详情页标记「有真题例句」用） */
export async function countSentences(instance: Cet4Database = defaultDb): Promise<number> {
  return instance.sentences.count();
}

/** 本地例句覆盖率 0..1（分母为词库条数） */
export async function sentenceCoverage(
  wordCount: number,
  instance: Cet4Database = defaultDb,
): Promise<number> {
  if (wordCount <= 0) return 0;
  const rows = await instance.words.filter((w) => w.sentenceCount > 0).count();
  return rows / wordCount;
}
