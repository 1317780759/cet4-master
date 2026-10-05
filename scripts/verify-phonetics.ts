/**
 * scripts/verify-phonetics.ts —— 音标产物门禁。
 *
 * 与 build-phonetics.ts 的关系：构建期「门禁前置」，有问题就不产出（与 verify-papers.ts 同纪律）。
 *
 * ★ src 标记位语义（与 build-phonetics.ts 的 SRC 常量必须一致）：
 *   0 = 英音美音都原生 / 1 = 仅一侧有原生音标 / 2 = 人工补录 / 3 = 两侧都缺
 *   标记位的存在意义：**永远不做跨方言冒充** —— 缺哪一侧就留空，
 *   拿美音填充英音栏位是静默的错误教学。
 *
 * ★ 允许的音标字符集用 Unicode 类别匹配（\p{L} + \p{M}），不用穷举 IPA 符号表 ——
 *   穷举表维护成本高，且任何遗漏都会把正确数据判成乱码。
 *
 * 运行：pnpm tsx scripts/verify-phonetics.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR, exists, readJson, sha256 } from './lib/pipeline';

const TAG = '[verify-phonetics]';

/** 源许可白名单：ipa-dict 是 MIT，其词条派生自 Wiktionary（CC BY-SA 4.0） */
export const LICENSE_WHITELIST: readonly string[] = ['MIT', 'CC-BY-SA-4.0', 'CC0-1.0', 'CC-BY-4.0'];

/** src 标记位语义 */
export const SRC = { native: 0, partial: 1, manual: 2, missing: 3 } as const;

/** 单条音标最大字符数（实测最长 24，留余量） */
export const MAX_PHONETIC_LEN = 32;

/** 覆盖率下限（实测 99.73%，补完人工条目应接近 100%） */
export const COVERAGE_FULL_MIN = 0.99;

/** 产物行：[wordId, uk, us, src] */
export type PhoneticRow = [string, string, string, number];

export interface PhoneticsIssue {
  code: string;
  level: 'error' | 'warn';
  message: string;
}

/** 音标字符集：Unicode 字母（含 IPA 字母与 ˈˌː 等修饰字母）+ 组合附加符号 + 少量标点，且绝不含斜杠 */
const IPA_ALLOWED = /^[\p{L}\p{M}][\p{L}\p{M} .·'’-]*$/u;

function checkIpa(ipa: string): boolean {
  if (ipa === '') return true;
  // 管线已去掉首尾斜杠；若还含斜杠说明管线有 bug
  if (ipa.includes('/')) return false;
  if (ipa.length > MAX_PHONETIC_LEN) return false;
  return IPA_ALLOWED.test(ipa);
}

export interface VerifyPhoneticsInput {
  rows: PhoneticRow[];
  coreRows: PhoneticRow[];
  coverage: number;
  coreCoverage: number;
  license?: string;
}

export function verifyPhonetics(input: VerifyPhoneticsInput): PhoneticsIssue[] {
  const issues: PhoneticsIssue[] = [];
  const { rows, coreRows, coverage, coreCoverage, license } = input;

  if (license && !LICENSE_WHITELIST.includes(license)) {
    issues.push({
      code: 'LICENSE_NOT_ALLOWED',
      level: 'error',
      message: `源许可 "${license}" 不在白名单 [${LICENSE_WHITELIST.join(', ')}] 内，禁止产出。`,
    });
  }

  if (rows.length === 0) {
    issues.push({ code: 'NO_ROWS', level: 'error', message: '产出条目数为 0（多半是 raw 源没放对）。' });
    return issues;
  }

  const checkList = (list: PhoneticRow[], label: string) => {
    const seen = new Set<string>();
    for (const row of list) {
      if (!Array.isArray(row) || row.length !== 4) {
        issues.push({ code: 'SCHEMA_INVALID', level: 'error', message: `${label} 行不是长度 4 的数组：${JSON.stringify(row)}` });
        continue;
      }
      const [id, uk, us, src] = row;
      if (typeof id !== 'string' || id === '') {
        issues.push({ code: 'SCHEMA_INVALID', level: 'error', message: `${label} 行的 id 非法：${JSON.stringify(row)}` });
      }
      if (seen.has(id)) {
        issues.push({ code: 'SCHEMA_INVALID', level: 'error', message: `${label} 出现重复 id：${id}` });
      }
      seen.add(id);

      if (typeof uk !== 'string' || typeof us !== 'string') {
        issues.push({ code: 'SCHEMA_INVALID', level: 'error', message: `${label} ${id} 的 uk/us 不是字符串。` });
        continue;
      }
      if (![0, 1, 2, 3].includes(src)) {
        issues.push({ code: 'SCHEMA_INVALID', level: 'error', message: `${label} ${id} 的 src=${src} 不在 0..3。` });
      }

      for (const [dialect, ipa] of [['uk', uk], ['us', us]] as const) {
        if (!checkIpa(ipa)) {
          const why = ipa.includes('/') ? '含斜杠（管线应已去掉）' : ipa.length > MAX_PHONETIC_LEN ? `超长（${ipa.length} > ${MAX_PHONETIC_LEN}）` : '含非法字符';
          issues.push({ code: ipa.includes('/') || ipa.length > MAX_PHONETIC_LEN ? 'IPA_CHARSET' : 'IPA_CHARSET', level: 'error', message: `${label} ${id} 的 ${dialect}="${ipa}" ${why}。` });
        }
      }

      // src 与内容必须自洽：有值却标缺失，或空值却标原生/借用/人工
      const has = uk !== '' || us !== '';
      if (has && src === SRC.missing) {
        issues.push({ code: 'SRC_MISLABELED', level: 'error', message: `${label} ${id} 有音标却标为缺失(src=3)。` });
      }
      if (!has && src !== SRC.missing) {
        issues.push({ code: 'SRC_MISLABELED', level: 'error', message: `${label} ${id} 无音标却标为 src=${src}。` });
      }
    }
  };

  checkList(rows, 'full');
  checkList(coreRows, 'core');

  if (coverage < COVERAGE_FULL_MIN) {
    issues.push({
      code: 'COVERAGE_LOW',
      level: 'error',
      message: `full 覆盖率 ${(coverage * 100).toFixed(2)}% 低于下限 ${(COVERAGE_FULL_MIN * 100).toFixed(0)}%。`,
    });
  }
  if (coreCoverage < COVERAGE_FULL_MIN) {
    issues.push({
      code: 'COVERAGE_LOW',
      level: 'warn',
      message: `core 覆盖率 ${(coreCoverage * 100).toFixed(2)}% 低于 ${(COVERAGE_FULL_MIN * 100).toFixed(0)}%。`,
    });
  }

  return issues;
}

/** CLI：校验磁盘上的产物（含 sha256 指纹一致性） */
async function verifyArtifacts(): Promise<PhoneticsIssue[]> {
  const dir = path.join(OUT_DIR, 'phonetics');
  const indexFile = path.join(dir, 'index.json');
  if (!(await exists(indexFile))) {
    return [{ code: 'NO_ROWS', level: 'error', message: `找不到 ${indexFile}，请先运行 pnpm data:phonetics。` }];
  }

  interface IndexFile {
    version: string;
    coverage: { core: number; full: number };
    scopes: Record<string, { file: string; sha256: string; count: number; bytes: number }>;
  }
  const index = (await readJson(indexFile)) as IndexFile;
  const issues: PhoneticsIssue[] = [];

  const scopes: Record<string, { rows: unknown; meta: IndexFile['scopes'][string] }> = {};
  for (const [name, meta] of Object.entries(index.scopes ?? {})) {
    const file = path.join(OUT_DIR, meta.file);
    if (!(await exists(file))) {
      issues.push({ code: 'FINGERPRINT_MISSING', level: 'error', message: `scope ${name} 的产物文件缺失：${meta.file}` });
      continue;
    }
    const buf = fs.readFileSync(file);
    const actual = sha256(buf);
    if (actual !== meta.sha256) {
      issues.push({
        code: 'FINGERPRINT_MISSING',
        level: 'error',
        message: `scope ${name} 的 sha256 与 index.json 不符（index=${meta.sha256.slice(0, 12)}… actual=${actual.slice(0, 12)}…），产物被手改或构建中断。`,
      });
    }
    const parsed = JSON.parse(buf.toString('utf8')) as { count: number; rows: PhoneticRow[] };
    if (parsed.count !== meta.count) {
      issues.push({ code: 'SCHEMA_INVALID', level: 'error', message: `scope ${name} 的 count(${parsed.count}) 与 index.json(${meta.count}) 不符。` });
    }
    scopes[name] = { rows: parsed.rows, meta };
  }

  const fullRows = (scopes['full']?.rows ?? []) as PhoneticRow[];
  const coreRows = (scopes['core']?.rows ?? []) as PhoneticRow[];
  issues.push(
    ...verifyPhonetics({
      rows: fullRows,
      coreRows,
      coverage: index.coverage?.full ?? 0,
      coreCoverage: index.coverage?.core ?? 0,
      license: 'MIT',
    }),
  );
  return issues;
}

function isDirectRun(): boolean {
  const entry = process.argv[1] ?? '';
  return /verify-phonetics\.(ts|js)$/.test(entry.replace(/\\/g, '/'));
}

async function cli(): Promise<void> {
  const issues = await verifyArtifacts();
  const errors = issues.filter((i) => i.level === 'error');
  for (const i of issues) {
    const prefix = i.level === 'error' ? '✗' : '⚠';
    console.log(`${TAG} ${prefix} [${i.code}] ${i.message}`);
  }
  if (errors.length > 0) {
    console.error(`${TAG} 未通过（${errors.length} 个 error）`);
    process.exit(1);
  }
  console.log(`${TAG} 通过（${issues.length} 个 warn）`);
}

// ★ 被 import 时不得自动执行 CLI（build-phonetics.ts 会 import 本文件）
if (isDirectRun()) {
  cli().catch((error: unknown) => {
    console.error(`${TAG} 失败：`, error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
