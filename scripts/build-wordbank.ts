/**
 * scripts/build-wordbank.ts —— 词库数据管线
 *
 * 流程：读取原始数据源 → 清洗 → **按词频排序** → tier 分档 → 分片 →
 *       产出 public/data/{manifest.json, words.index.*.json, words/chunk-*.json}
 *
 * ★ 数据源：exam-data/CETVocabulary（CC BY-NC-SA 4.0，非商用）
 *   原始文件放 scripts/data/raw/（.gitignore，绝不入库）；
 *   本脚本只输出**派生的结构化数据**，并在每条 Word 上写入 source / license 留痕。
 *
 * 运行：pnpm data:build   （等价于 tsx scripts/build-wordbank.ts）
 */

import path from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import type { Word, WordIndexRow } from '../src/domain/word/types';
// ★ tier 判定复用领域层的唯一实现，避免脚本与运行时出现两份分档逻辑（防止漂移）
import { CORE_BOUNDARY, tierOf } from '../src/domain/word/tier';
import { toIndexRow } from '../src/domain/word/types';
import { wordId } from '../src/lib/id';
import {
  exists,
  ensureDir,
  formatBytes,
  OUT_DIR,
  pad3,
  RAW_DIR,
  readJson,
  sha256,
  versionDateKey,
  writeJson,
  GENERATED_DIR,
} from './lib/pipeline';
import type { AttributionInfo, DataManifest, WordChunkFile, WordIndexFile } from '../src/data/types';

/** 每片词数：5278 / 550 ≈ 10 片，与实现方案的 chunk-001…chunk-010 一致 */
const CHUNK_SIZE = 550;

const RAW_FILE_CANDIDATES = ['cet_full_list.json', 'cet4.json', 'words.json'];

/** 原始条目形状（中文键，来自上游） */
interface RawEntry {
  序号?: number | null;
  词频?: number | null;
  六级?: string | null;
  单词?: string | null;
  释义?: string | null;
  其他拼写?: string | null;
  分类?: string | null;
  子分类?: string | null;
}

interface SourceMeta extends AttributionInfo {
  rawFile?: string;
  upstreamDate?: string;
  note?: string;
}

/** 清洗后的中间结构 */
interface CleanEntry {
  seq: number;
  headword: string;
  freqCount: number;
  isCet6: boolean;
  gloss: string;
  variants: string[];
  category: string | null;
  subCategory: string | null;
}

function pickRecords(raw: unknown): RawEntry[] {
  if (Array.isArray(raw)) return raw as RawEntry[];
  if (raw && typeof raw === 'object') {
    for (const value of Object.values(raw as Record<string, unknown>)) {
      if (Array.isArray(value)) return value as RawEntry[];
    }
  }
  throw new Error('无法从原始文件中识别词条数组（期望顶层数组或含数组的对象）');
}

/** 解析「其他拼写」：上游是单个字符串，按中英文顿号/逗号切分 */
function parseSpellings(input: string | null | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[、,，;；/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 解析释义为中文义项数组。
 * 上游只有一串中文（不标词性），因此 pos 一律为 'unknown' —— 不臆造词性。
 */
function parseGloss(gloss: string): Array<{ pos: 'unknown'; zh: string }> {
  const parts = gloss
    .split(/[、,，;；]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.map((zh) => ({ pos: 'unknown' as const, zh }));
}

function toNumber(value: number | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function clean(records: readonly RawEntry[]): {
  entries: CleanEntry[];
  skipped: number;
  duplicates: string[];
} {
  const bySlug = new Map<string, CleanEntry>();
  const duplicates: string[] = [];
  let skipped = 0;

  for (const [index, record] of records.entries()) {
    const headword = (record.单词 ?? '').trim();
    if (!headword) {
      skipped += 1;
      continue;
    }
    const entry: CleanEntry = {
      seq: toNumber(record.序号) || index + 1,
      headword,
      freqCount: toNumber(record.词频),
      isCet6: record.六级 === '★',
      gloss: (record.释义 ?? '').trim(),
      variants: parseSpellings(record.其他拼写),
      category: (record.分类 ?? '').trim() || null,
      subCategory: (record.子分类 ?? '').trim() || null,
    };
    const key = wordId(headword);
    const prev = bySlug.get(key);
    if (!prev) {
      bySlug.set(key, entry);
      continue;
    }
    duplicates.push(headword);
    // 同词重复出现：保留词频更高者（词频相同则保留序号更小者）
    if (entry.freqCount > prev.freqCount) bySlug.set(key, entry);
  }

  // ★ 核心排序：词频降序（= freqRank 升序），同频按上游序号稳定排序
  const entries = [...bySlug.values()].sort((a, b) => {
    if (b.freqCount !== a.freqCount) return b.freqCount - a.freqCount;
    return a.seq - b.seq;
  });

  return { entries, skipped, duplicates };
}

function buildWords(entries: readonly CleanEntry[], source: string, license: string): Word[] {
  return entries.map((entry, index) => {
    const freqRank = index + 1;
    const word: Word = {
      id: wordId(entry.headword),
      headword: entry.headword,
      variants: entry.variants,
      senses: parseGloss(entry.gloss),
      freqRank,
      freqCount: entry.freqCount,
      tier: tierOf(freqRank),
      isCet6: entry.isCet6,
      category: entry.category ?? undefined,
      subCategory: entry.subCategory ?? undefined,
      chunk: Math.floor(index / CHUNK_SIZE) + 1,
      sentenceCount: 0, // M1 例句管线接入后回填
      source,
      license,
    };
    return word;
  });
}

async function resolveRawFile(): Promise<string> {
  for (const name of RAW_FILE_CANDIDATES) {
    const file = path.join(RAW_DIR, name);
    if (await exists(file)) return file;
  }
  throw new Error(
    `未找到原始数据源。请把 cet_full_list.json 放到 ${RAW_DIR} 后重试。\n` +
      `数据源：https://github.com/exam-data/CETVocabulary（CC BY-NC-SA 4.0，非商用）`,
  );
}

async function loadSourceMeta(): Promise<SourceMeta> {
  const file = path.join(ROOT_SOURCE_META);
  if (await exists(file)) return readJson<SourceMeta>(file);
  return {
    sourceId: 'exam-data/CETVocabulary',
    name: '四六级词汇词频排序数据（exam-data/CETVocabulary）',
    url: 'https://github.com/exam-data/CETVocabulary',
    license: 'CC BY-NC-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    commercialUse: false,
    fetchedAt: '',
    upstreamRef: 'unknown',
  };
}

const ROOT_SOURCE_META = path.join(RAW_DIR, '..', 'source-meta.json');

interface ChunkOutput {
  index: number;
  file: string;
  sha256: string;
  count: number;
  bytes: number;
}

async function main(): Promise<void> {
  const rawFile = await resolveRawFile();
  const meta = await loadSourceMeta();
  const raw = await readJson<unknown>(rawFile);
  const records = pickRecords(raw);

  console.log(`[1/6] 读取原始数据源：${path.relative(process.cwd(), rawFile)}`);
  console.log(`      原始条目：${records.length}`);

  const { entries, skipped, duplicates } = clean(records);
  console.log(
    `[2/6] 清洗完成：有效 ${entries.length} 条，跳过 ${skipped} 条，去重 ${duplicates.length} 条`,
  );
  if (duplicates.length > 0) {
    console.log(`      重复词：${duplicates.slice(0, 10).join(' / ')}`);
  }

  const sourceTag = `exam-data/CETVocabulary@${meta.upstreamRef.slice(0, 7)}`;
  const words = buildWords(entries, sourceTag, meta.license);
  console.log(`[3/6] 词频排序 + tier 分档完成：${words.length} 条`);

  // —— 分片 ——
  await ensureDir(OUT_DIR);
  await ensureDir(path.join(OUT_DIR, 'words'));
  // 清空旧的 chunk 文件，避免分片数变少时留下孤儿文件
  await removeStaleChunks();

  const chunkCount = Math.ceil(words.length / CHUNK_SIZE);
  const chunks: ChunkOutput[] = [];
  let payloadHash = sha256('');

  for (let index = 1; index <= chunkCount; index += 1) {
    const slice = words.slice((index - 1) * CHUNK_SIZE, index * CHUNK_SIZE);
    const payload: WordChunkFile = { chunk: index, count: slice.length, words: slice };
    const relative = `words/chunk-${pad3(index)}.json`;
    const { bytes, sha256: hash } = await writeJson(path.join(OUT_DIR, relative), payload);
    payloadHash = sha256(payloadHash + hash);
    chunks.push({ index, file: relative, sha256: hash, count: slice.length, bytes });
  }
  console.log(`[4/6] 分片完成：${chunkCount} 片 × ≤${CHUNK_SIZE} 词`);

  // —— 索引（列式，首屏极速构建学习队列）——
  const allRows: WordIndexRow[] = words.map(toIndexRow);
  const coreRows = allRows.filter((row) => row.r <= CORE_BOUNDARY);

  const coreFile: WordIndexFile = {
    version: versionDateKey(),
    count: coreRows.length,
    rows: coreRows,
  };
  const fullFile: WordIndexFile = {
    version: versionDateKey(),
    count: allRows.length,
    rows: allRows,
  };
  const coreOut = await writeJson(path.join(OUT_DIR, 'words.index.core.json'), coreFile);
  const fullOut = await writeJson(path.join(OUT_DIR, 'words.index.full.json'), fullFile);
  console.log(
    `[5/6] 索引完成：core ${coreRows.length} 行（${formatBytes(coreOut.bytes)}）/ full ${allRows.length} 行（${formatBytes(fullOut.bytes)}）`,
  );

  // —— manifest ——
  // version 采用「日期 + 内容指纹」：内容不变 → 版本不变 → 用户不会被迫重下
  const version = `${versionDateKey()}.${payloadHash.slice(0, 8)}`;
  const manifest: DataManifest = {
    version,
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-wordbank.ts',
    wordCount: words.length,
    coreCount: coreRows.length,
    coreBoundary: CORE_BOUNDARY,
    chunkSize: CHUNK_SIZE,
    chunkCount,
    chunkFilePattern: 'words/chunk-{n}.json',
    indexes: {
      core: {
        file: 'words.index.core.json',
        sha256: coreOut.sha256,
        count: coreRows.length,
      },
      full: {
        file: 'words.index.full.json',
        sha256: fullOut.sha256,
        count: allRows.length,
      },
    },
    chunks,
    sentences: {
      available: false,
      count: 0,
      coverage: 0,
      note: '例句管线属于 M1，本版本尚未接入；sentenceCount 全部为 0',
    },
    attribution: {
      sourceId: meta.sourceId,
      name: meta.name,
      url: meta.url,
      license: meta.license,
      licenseUrl: meta.licenseUrl,
      commercialUse: meta.commercialUse,
      fetchedAt: meta.fetchedAt || new Date().toISOString(),
      upstreamRef: meta.upstreamRef,
    },
  };
  const manifestOut = await writeJson(path.join(OUT_DIR, 'manifest.json'), manifest);
  console.log(`[6/6] manifest 完成：version=${version}（${formatBytes(manifestOut.bytes)}）`);

  // —— 中间产物（供 verify-data 与人工排查，已 gitignore）——
  await ensureDir(GENERATED_DIR);
  await writeJson(path.join(GENERATED_DIR, 'words.json'), {
    version,
    source: sourceTag,
    license: meta.license,
    count: words.length,
    words,
  });
  await writeJson(path.join(GENERATED_DIR, 'report.json'), {
    version,
    rawRecords: records.length,
    cleaned: entries.length,
    skipped,
    duplicates,
    chunkCount,
    chunkSize: CHUNK_SIZE,
    coreBoundary: CORE_BOUNDARY,
    boundaryFreq: words[CORE_BOUNDARY - 1]?.freqCount ?? null,
    totalBytes: chunks.reduce((sum, c) => sum + c.bytes, 0),
  });

  const totalBytes = chunks.reduce((sum, c) => sum + c.bytes, 0);
  console.log('');
  console.log('———— 构建报告 ————');
  console.log(`词数            : ${words.length}`);
  console.log(`Top2104 边界    : rank ${CORE_BOUNDARY} 词频 ${words[CORE_BOUNDARY - 1]?.freqCount ?? '—'}（第 ${CORE_BOUNDARY + 1} 名：${words[CORE_BOUNDARY]?.freqCount ?? '—'}）`);
  console.log(`tier 分布       : core2104=${words.filter((w) => w.tier === 'core2104').length} cet4=${words.filter((w) => w.tier === 'cet4').length} extended=${words.filter((w) => w.tier === 'extended').length}`);
  console.log(`六级词          : ${words.filter((w) => w.isCet6).length}`);
  console.log(`分片            : ${chunkCount} 片，合计 ${formatBytes(totalBytes)}`);
  console.log(`数据源          : ${sourceTag} · ${meta.license}`);
  console.log('');
  console.log('请继续执行：pnpm data:verify && pnpm data:attribution');
}

async function removeStaleChunks(): Promise<void> {
  const dir = path.join(OUT_DIR, 'words');
  await ensureDir(dir);
  const files = await readdir(dir);
  await Promise.all(
    files.filter((f) => f.startsWith('chunk-') && f.endsWith('.json')).map((f) => rm(path.join(dir, f))),
  );
}

main().catch((error: unknown) => {
  console.error('[build-wordbank] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});

export { clean, buildWords, parseGloss, parseSpellings, CHUNK_SIZE };
