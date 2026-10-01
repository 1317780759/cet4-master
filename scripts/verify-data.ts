/**
 * scripts/verify-data.ts —— 词库数据体检（CI 门禁）
 *
 * 体检对象是**构建产物** public/data/（而非原始数据源），
 * 因此 CI 上无需私有数据即可运行。
 *
 * 运行：pnpm data:verify
 * 退出码：有 ERROR 时 1，否则 0。
 */

import path from 'node:path';
import type { Word, WordIndexRow } from '../src/domain/word/types';
import { CET4_BOUNDARY, CORE_BOUNDARY, isRankAscendingAndContinuous } from '../src/domain/word/tier';
import { TIER_FROM_CODE } from '../src/domain/word/types';
import type { DataManifest, WordChunkFile, WordIndexFile } from '../src/data/types';
import { OUT_DIR, exists, formatBytes, pad3, readJson, readText, sha256, writeText } from './lib/pipeline';

type Level = 'info' | 'pass' | 'warn' | 'error' | 'skip';

interface CheckResult {
  name: string;
  level: Level;
  message: string;
}

const results: CheckResult[] = [];

function record(name: string, level: Level, message: string): void {
  results.push({ name, level, message });
}

const SYMBOL: Record<Level, string> = {
  info: '·',
  pass: '✓',
  warn: '!',
  error: '✗',
  skip: '-',
};

/** 全部条目（跨分片） */
interface LoadedData {
  manifest: DataManifest;
  words: Word[];
  coreRows: WordIndexRow[];
  fullRows: WordIndexRow[];
  chunkBytes: number;
}

async function loadData(): Promise<LoadedData> {
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  if (!(await exists(manifestPath))) {
    throw new Error(`缺少 public/data/manifest.json —— 请先执行 pnpm data:build`);
  }
  const manifest = await readJson<DataManifest>(manifestPath);

  const words: Word[] = [];
  let chunkBytes = 0;
  for (let index = 1; index <= manifest.chunkCount; index += 1) {
    const file = path.join(OUT_DIR, 'words', `chunk-${pad3(index)}.json`);
    if (!(await exists(file))) {
      throw new Error(`manifest 声明了 ${manifest.chunkCount} 片，但缺少 ${path.basename(file)}`);
    }
    const raw = await readText(file);
    chunkBytes += Buffer.byteLength(raw, 'utf8');
    const parsed = JSON.parse(raw) as WordChunkFile;
    words.push(...parsed.words);
  }

  const core = await readJson<WordIndexFile>(path.join(OUT_DIR, manifest.indexes.core.file));
  const full = await readJson<WordIndexFile>(path.join(OUT_DIR, manifest.indexes.full.file));

  return { manifest, words, coreRows: core.rows, fullRows: full.rows, chunkBytes };
}

/** 校验分片 sha256 时统一走这里，避免重复读文件 */
async function fileSha256(file: string): Promise<string> {
  return sha256(await readText(file));
}

function checkManifest(m: DataManifest): void {
  const missing: string[] = [];
  if (!m.version) missing.push('version');
  if (!m.generatedAt) missing.push('generatedAt');
  if (!m.wordCount) missing.push('wordCount');
  if (!m.coreCount) missing.push('coreCount');
  if (!Array.isArray(m.chunks) || m.chunks.length === 0) missing.push('chunks');
  if (!m.attribution) missing.push('attribution');
  record(
    'manifest 字段完整性',
    missing.length === 0 ? 'pass' : 'error',
    missing.length === 0 ? '必需字段齐全' : `缺失：${missing.join(', ')}`,
  );

  const a = m.attribution;
  const ok = Boolean(a?.sourceId && a?.license && a?.url) && a?.commercialUse === false;
  record(
    '合规溯源（C5）',
    ok ? 'pass' : 'error',
    ok
      ? `${a.sourceId} · ${a.license} · 非商用标记正确`
      : 'attribution 必须含 sourceId/license/url 且 commercialUse=false',
  );
}

function checkCounts(m: DataManifest, words: readonly Word[]): void {
  record(
    '词条总数与 manifest 一致',
    words.length === m.wordCount ? 'pass' : 'error',
    `实际 ${words.length} / 声明 ${m.wordCount}`,
  );

  const ids = new Set<string>();
  const dupIds = new Set<string>();
  for (const w of words) {
    if (ids.has(w.id)) dupIds.add(w.id);
    ids.add(w.id);
  }
  record(
    'Word.id 无重复',
    dupIds.size === 0 ? 'pass' : 'error',
    dupIds.size === 0 ? `${ids.size} 个唯一 id` : `重复 ${dupIds.size} 个：${[...dupIds].slice(0, 5).join(', ')}`,
  );

  // 注意：按**原始大小写**判定重复。考纲里 may/May、march/March 是各自独立的词条，
  // 用小写归一会把它们误报成重复。
  const heads = new Set<string>();
  const dupHeads = new Set<string>();
  for (const w of words) {
    const key = w.headword.trim();
    if (heads.has(key)) dupHeads.add(key);
    heads.add(key);
  }
  record(
    'headword 无重复（区分大小写）',
    dupHeads.size === 0 ? 'pass' : 'warn',
    dupHeads.size === 0 ? '无重复' : `重复 ${dupHeads.size} 个：${[...dupHeads].slice(0, 5).join(', ')}`,
  );
}

function checkOrdering(words: readonly Word[], chunkSize: number): void {
  const sorted = [...words].sort((a, b) => a.freqRank - b.freqRank);
  record(
    'freqRank 连续 1..N',
    isRankAscendingAndContinuous(sorted) ? 'pass' : 'error',
    isRankAscendingAndContinuous(sorted) ? `1..${sorted.length} 连续` : 'freqRank 存在断号或重复',
  );

  let monotonic = true;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].freqCount > sorted[i - 1].freqCount) {
      monotonic = false;
      break;
    }
  }
  record(
    '词频单调不增（排序正确）',
    monotonic ? 'pass' : 'error',
    monotonic ? '按词频降序排列' : '存在词频升序的相邻对，排序有误',
  );

  const badTier = sorted.filter((w) => {
    const expected = w.freqRank <= CORE_BOUNDARY ? 'core2104' : 'cet4';
    return w.tier !== expected && !(w.freqRank > CET4_BOUNDARY && w.tier === 'extended');
  });
  record(
    'tier 与 freqRank 一致',
    badTier.length === 0 ? 'pass' : 'error',
    badTier.length === 0 ? '全部匹配' : `${badTier.length} 条不匹配，例：${badTier[0]?.headword}`,
  );

  const badChunk = words.filter((w) => w.chunk !== Math.floor((w.freqRank - 1) / chunkSize) + 1);
  record(
    'chunk 字段与分片一致',
    badChunk.length === 0 ? 'pass' : 'error',
    badChunk.length === 0 ? '全部匹配' : `${badChunk.length} 条错分，例：${badChunk[0]?.headword}`,
  );
}

function checkCoreBoundary(m: DataManifest, words: readonly Word[]): void {
  const sorted = [...words].sort((a, b) => a.freqRank - b.freqRank);
  const expectedCore = Math.min(words.length, CORE_BOUNDARY);
  record(
    'Top2104 边界条数',
    m.coreCount === expectedCore ? 'pass' : 'error',
    `coreCount=${m.coreCount}（期望 ${expectedCore}）`,
  );

  const last = sorted[CORE_BOUNDARY - 1];
  const next = sorted[CORE_BOUNDARY];
  const boundaryOk = Boolean(last && last.freqCount >= 40 && (!next || next.freqCount < last.freqCount));
  record(
    'Top2104 词频边界（≥40 次）',
    boundaryOk ? 'pass' : 'error',
    last
      ? `rank ${last.freqRank} = ${last.headword}（${last.freqCount} 次）；rank ${next?.freqRank ?? '—'} = ${next?.headword ?? '—'}（${next?.freqCount ?? '—'} 次）`
      : '词数不足，无法校验边界',
  );

  const coreInWords = sorted.filter((w) => w.tier === 'core2104').length;
  record(
    'core2104 档位条数',
    coreInWords === expectedCore ? 'pass' : 'error',
    `${coreInWords} 条`,
  );
}

function checkComplianceFields(words: readonly Word[]): void {
  const badSource = words.filter((w) => !w.source);
  const badLicense = words.filter((w) => !w.license);
  const ok = badSource.length === 0 && badLicense.length === 0;
  record(
    'Word.source / Word.license 非空（C5-B2）',
    ok ? 'pass' : 'error',
    ok
      ? `全部 ${words.length} 条均带溯源与许可`
      : `缺 source ${badSource.length} 条 / 缺 license ${badLicense.length} 条`,
  );

  const badSense = words.filter((w) => !Array.isArray(w.senses) || w.senses.length === 0);
  record(
    '释义非空',
    badSense.length === 0 ? 'pass' : 'warn',
    badSense.length === 0 ? '全部词条均有释义' : `${badSense.length} 条无释义`,
  );
}

function checkIndex(m: DataManifest, rows: readonly WordIndexRow[], kind: 'core' | 'full'): void {
  const meta = m.indexes[kind];
  record(
    `${kind} 索引行数`,
    rows.length === meta.count ? 'pass' : 'error',
    `${rows.length} 行（manifest 声明 ${meta.count}）`,
  );

  if (kind === 'core') {
    const outOfRange = rows.filter((r) => r.r > CORE_BOUNDARY);
    record(
      'core 索引仅含 Top2104',
      outOfRange.length === 0 ? 'pass' : 'error',
      outOfRange.length === 0 ? '范围正确' : `${outOfRange.length} 行越界`,
    );
  }

  const badTierCode = rows.filter((r) => !TIER_FROM_CODE[r.t]);
  record(
    `${kind} 索引 tier 压缩码合法`,
    badTierCode.length === 0 ? 'pass' : 'error',
    badTierCode.length === 0 ? '0/1/2 合法' : `${badTierCode.length} 行非法`,
  );
}

async function checkChunkHashes(m: DataManifest): Promise<void> {
  const mismatched: string[] = [];
  for (const chunk of m.chunks) {
    const file = path.join(OUT_DIR, chunk.file);
    if (!(await exists(file))) {
      mismatched.push(`${chunk.file}（缺失）`);
      continue;
    }
    const actual = await fileSha256(file);
    if (actual !== chunk.sha256) mismatched.push(chunk.file);
  }
  record(
    '分片 sha256 校验',
    mismatched.length === 0 ? 'pass' : 'error',
    mismatched.length === 0 ? `${m.chunks.length} 片全部一致` : `不一致：${mismatched.join(', ')}`,
  );
}

async function main(): Promise<void> {
  const data = await loadData();
  const { manifest, words } = data;

  checkManifest(manifest);
  checkCounts(manifest, words);
  checkOrdering(words, manifest.chunkSize);
  checkCoreBoundary(manifest, words);
  checkComplianceFields(words);
  checkIndex(manifest, data.coreRows, 'core');
  checkIndex(manifest, data.fullRows, 'full');
  await checkChunkHashes(manifest);

  // —— 例句覆盖率：M0 例句管线未接入，标记 skip 而非 fail ——
  const withSentence = words.filter((w) => w.sentenceCount > 0).length;
  const coverage = words.length > 0 ? withSentence / words.length : 0;
  record(
    '例句覆盖率（目标 ≥90%）',
    coverage >= 0.9 ? 'pass' : 'skip',
    `当前 ${(coverage * 100).toFixed(1)}%（${withSentence}/${words.length}）—— 例句管线属于 M1，本轮跳过`,
  );

  // —— 输出报告 ——
  const lines: string[] = [];
  lines.push('# 数据体检报告');
  lines.push('');
  lines.push(`- manifest 版本：\`${manifest.version}\``);
  lines.push(`- 生成时间：${manifest.generatedAt}`);
  lines.push(`- 词条数：${words.length}（core ${manifest.coreCount}）`);
  lines.push(`- 分片：${manifest.chunkCount} 片 × ≤${manifest.chunkSize} 词，合计 ${formatBytes(data.chunkBytes)}`);
  lines.push(`- 数据源：${manifest.attribution.sourceId} @ ${manifest.attribution.upstreamRef.slice(0, 7)} · ${manifest.attribution.license}`);
  lines.push('');
  lines.push('| 结果 | 检查项 | 说明 |');
  lines.push('|---|---|---|');
  for (const r of results) {
    lines.push(`| ${SYMBOL[r.level]} ${r.level.toUpperCase()} | ${r.name} | ${r.message} |`);
  }
  lines.push('');

  const errors = results.filter((r) => r.level === 'error');
  const warns = results.filter((r) => r.level === 'warn');
  lines.push(`结论：**${errors.length === 0 ? 'PASS' : 'FAIL'}**（error ${errors.length} / warn ${warns.length}）`);
  lines.push('');

  const report = lines.join('\n');
  console.log(report);
  await writeText(path.join(OUT_DIR, 'VERIFY-REPORT.md'), report);

  if (errors.length > 0) {
    console.error(`[verify-data] ${errors.length} 项体检未通过`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('[verify-data] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
