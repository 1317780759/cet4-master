/**
 * scripts/build-sentences.ts —— 真题例句管线（M1 交付「例句渲染能力」）。
 *
 * ★ 范围说明（实现方案 R2）：
 *   M1 交付的是**例句渲染能力**（span 定位高亮、点击跳详情），
 *   例句**语料本身**属 M2 数据工作（需跑真题抽取管线，涉及版权）。
 *   因此本脚本在**没有原始语料时安全 no-op**：
 *     - 不创建任何空分片
 *     - 不改动 manifest.sentences（保持 available=false / coverage=0）
 *   绝不为了凑覆盖率而伪造例句。
 *
 * 期望输入（任选其一，放在 `scripts/data/raw/sentences/` 下，该目录 .gitignore）：
 *   - 单个 `sentences.json`：`{ "items": RawSentence[] }`
 *   - 或任意数量的 `*.json`：文件内容为 `RawSentence[]` 或 `{ "items": RawSentence[] }`
 *
 * 硬性校验（R2）：`en.slice(span[0], span[1]) === targetForm`；
 *   不通过时尝试用 indexOf 重新定位，仍失败则**丢弃该条**（宁可少，不可错位）。
 *
 * 运行：pnpm data:sentences
 */

import path from 'node:path';
import type { ExamSentence } from '../src/domain/exam/types';
import {
  ensureDir,
  exists,
  OUT_DIR,
  RAW_DIR,
  readJson,
  readText,
  writeJson,
  writeText,
} from './lib/pipeline';

interface RawSentence {
  wordId: string;
  paperId: string;
  questionId: string;
  sectionKind: ExamSentence['sectionKind'];
  questionNo?: number;
  en: string;
  zh?: string;
  targetForm: string;
  span: [number, number];
  gap?: [number, number];
}

interface SentencedChunkFile {
  chunk: number;
  count: number;
  sentences: ExamSentence[];
}

const SENTENCE_DIR = path.join(RAW_DIR, 'sentences');
const OUT_SENTENCE_DIR = path.join(OUT_DIR, 'sentences');
const CHUNK_SIZE = 1000;

/** 定位并解析一条原始例句的 span（纯函数） */
function normalizeSpan(raw: RawSentence): [number, number] | null {
  const { en, targetForm, span } = raw;
  const [start, end] = span;
  if (start >= 0 && end > start && end <= en.length && en.slice(start, end) === targetForm) {
    return [start, end];
  }
  const idx = en.indexOf(targetForm);
  if (idx >= 0) return [idx, idx + targetForm.length];
  return null;
}

/** 收集全部原始例句 */
async function readRawSentences(): Promise<RawSentence[]> {
  if (!(await exists(SENTENCE_DIR))) return [];
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(SENTENCE_DIR)).filter((f) => f.endsWith('.json'));
  const out: RawSentence[] = [];
  for (const file of files) {
    const full = path.join(SENTENCE_DIR, file);
    const text = await readText(full);
    const parsed = JSON.parse(text) as RawSentence[] | { items: RawSentence[] };
    if (Array.isArray(parsed)) out.push(...parsed);
    else if (Array.isArray(parsed.items)) out.push(...parsed.items);
  }
  return out;
}

async function main(): Promise<void> {
  const raw = await readRawSentences();
  if (raw.length === 0) {
    console.log(
      '[build-sentences] 未发现原始例句语料（scripts/data/raw/sentences/ 为空）。' +
        '\n  → 例句语料属 M2 数据工作；M1 保持 manifest.sentences.available=false，' +
        'UI 优雅降级为「词频 + 释义」。本脚本不做任何改动。',
    );
    return;
  }

  const valid: ExamSentence[] = [];
  let dropped = 0;
  let seq = 0;
  for (const item of raw) {
    const span = normalizeSpan(item);
    if (!span) {
      dropped += 1;
      continue;
    }
    seq += 1;
    const sentence: ExamSentence = {
      id: `s_${`${seq}`.padStart(6, '0')}`,
      wordId: item.wordId,
      paperId: item.paperId,
      questionId: item.questionId,
      sectionKind: item.sectionKind,
      en: item.en,
      targetForm: item.targetForm,
      span,
    };
    if (item.questionNo !== undefined) sentence.questionNo = item.questionNo;
    if (item.zh !== undefined) sentence.zh = item.zh;
    if (item.gap !== undefined) sentence.gap = item.gap;
    valid.push(sentence);
  }

  console.log(
    `[build-sentences] 读入 ${raw.length} 条，校验通过 ${valid.length} 条，丢弃 ${dropped} 条（span 无法定位）`,
  );
  if (valid.length === 0) {
    console.log('[build-sentences] 无有效例句，保持 public/data 不变。');
    return;
  }

  await ensureDir(OUT_SENTENCE_DIR);
  const chunkCount = Math.ceil(valid.length / CHUNK_SIZE);
  for (let index = 1; index <= chunkCount; index += 1) {
    const slice = valid.slice((index - 1) * CHUNK_SIZE, index * CHUNK_SIZE);
    const payload: SentencedChunkFile = { chunk: index, count: slice.length, sentences: slice };
    await writeJson(path.join(OUT_SENTENCE_DIR, `chunk-${`${index}`.padStart(3, '0')}.json`), payload);
  }

  // 用到的词 → sentenceCount 更新（仅更新本地词条镜像，不动用户进度）
  const coverage = await patchManifest(valid.length, chunkCount);
  await writeText(
    path.join(OUT_DIR, 'sentences', 'INDEX.md'),
    `# 例句分片\n\n共 ${valid.length} 条，${chunkCount} 片，覆盖 ${coverage} 个词。\n`,
  );
  console.log(`[build-sentences] 写出 ${chunkCount} 片，覆盖 ${coverage} 个词。`);
}

/** 更新 manifest.sentences 元信息，返回覆盖词数 */
async function patchManifest(count: number, chunkCount: number): Promise<number> {
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  if (!(await exists(manifestPath))) {
    console.log('[build-sentences] 缺少 manifest.json —— 请先执行 pnpm data:build。');
    return 0;
  }
  const manifest = await readJson<{
    wordCount?: number;
    sentences?: { available: boolean; count: number; coverage: number; note: string };
  }>(manifestPath);
  const wordIds = new Set(await readChunkWordIds(chunkCount));
  const totalWords = manifest.wordCount ?? 0;
  manifest.sentences = {
    available: true,
    count,
    coverage: totalWords > 0 ? wordIds.size / totalWords : 0,
    note: '由 scripts/build-sentences.ts 生成',
  };
  await writeJson(manifestPath, manifest);
  return wordIds.size;
}

async function readChunkWordIds(chunkCount: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 1; index <= chunkCount; index += 1) {
    const file = path.join(OUT_SENTENCE_DIR, `chunk-${`${index}`.padStart(3, '0')}.json`);
    const parsed = await readJson<SentencedChunkFile>(file);
    for (const sentence of parsed.sentences) ids.push(sentence.wordId);
  }
  return ids;
}

main().catch((error: unknown) => {
  console.error('[build-sentences] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
