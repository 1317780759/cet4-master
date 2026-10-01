/**
 * 禁用词门禁 —— 规则与扫描的**单一真源**（本文件是唯一实现处）。
 *
 * ── 依赖方向（禁止倒置）─────────────────────────────────────────────
 *      scripts/forbidden-words.ts
 *              ▲ import
 *              │
 *   tests/fixtures/** · tests/compliance/** · scripts/check-forbidden-words.ts(CI)
 *   ❌ 禁止本文件（或 scripts/ 下任何脚本）反向 import `tests/**`
 *      —— CI 不得依赖测试目录；规则住在 scripts/，样例数据可留在 tests/。
 * ────────────────────────────────────────────────────────────────────
 *
 * 规则口径由 team-lead 裁决（docs/04 §5.4 / docs/03 §8.2 / §9.1）：
 *   - 「425 / 710」类：**正向 + 逆向并行**，不放任何白名单（含否定式一律拦截）；
 *   - 「官方」类：保留负向断言 `(?<![非未不])`，放行「非 / 未 / 不」**紧邻**「官方」的形态。
 *
 * ⚠️ 未使用 `g` 标志：`.test()` 因此无状态、可安全复用（带 `g` 会因 lastIndex 串扰）。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 门禁样例（正例应拦 / 反例应放行） */
export interface ForbiddenSample {
  /** 用例编号 */
  id: string;
  /** 被测文本 */
  text: string;
  /** 期望：block = 应被门禁拦截；pass = 应放行（不误伤） */
  expected: 'block' | 'pass';
  /** 出处（PRD / 设计文档的哪一条） */
  provenance: string;
  /** 预期命中的模式名（文档用途；不作强断言，允许正则演进） */
  caughtBy?: string;
}

/**
 * 门禁正则集合（唯一真源）。
 *
 * ⚠️ 全部不加 `g` 标志（见文件头说明）。
 */
export const GATE_PATTERNS: Record<string, RegExp> = {
  /** 「官方」词族：放行「非/未/不」紧邻前缀（否定式免责文案） */
  negationOfficial: /(?<![非未不])官方(真题|答案|发布|版)/,
  /** 考试院 / 考试中心 认证或授权，同样放行否定前缀 */
  negationExamAuth: /(?<![非未])考试(院|中心)(认证|授权)/,
  rawPaper: /真题原卷/,
  authoritative: /权威真题/,
  fullMock: /全真模考/,
  /** 425 / 710 换算：正向（数字在前，放宽版，含「折算 / 预测」） */
  scoreForward: /(425|710)\s*分?\s*(预估|换算|折算|预测)/,
  /** 425 / 710 换算：逆向（关键词在前，补语序反转） */
  scoreReverse: /(预估|换算|折算|预测)[^。；，]{0,6}(425|710)/,
};

/** 命中返回模式名，否则返回 null */
export function firstForbiddenMatch(text: string): string | null {
  for (const [name, re] of Object.entries(GATE_PATTERNS)) {
    if (re.test(text)) return name;
  }
  return null;
}

/**
 * 扫描范围：递归目录根（相对仓库根）。
 * 仅 `src/**`（对外可见的应用源码）。
 */
export const SCAN_ROOTS = ['src'] as const;

/**
 * 扫描范围：显式单文件（相对仓库根）。
 *
 * 两类显式纳入：
 *   - `README.md`                   —— 对外可见的仓库首页文档（docs/04 §5.7.1）
 *   - `public/data/ATTRIBUTION.md`  —— **唯一**由我们自撰、且对用户展示的 public/data 文件
 *
 * ⚠️ 严禁退化为「全量扫 `public/`」：词库分片里的 `freqRank` 等数值（如 rank=710）
 * 会带来「710」假阳性；且 `public/data/**` 语料为第三方/生成内容，我们无权改写。
 */
export const SCAN_FILES = ['README.md', 'public/data/ATTRIBUTION.md'] as const;

/** 扫描的后缀白名单 */
export const SCAN_EXTENSIONS = ['.ts', '.tsx', '.html', '.json', '.md'] as const;

/**
 * 显式排除的目录名 —— 即便将来 `SCAN_ROOTS` 被放宽，也强制跳过这些目录。
 *
 * 排除原因（写在这里，避免下一位维护者以为是漏配置而"修好"它，把红灯引回来）：
 *   - `tests/`  ：回归 fixture **必然包含禁用词串本身**（否则无法验证拦截），进入范围会「命中自己」；
 *   - `scripts/`：本规则实现文件本体含正则与样例字样；
 *   - `docs/`   ：内部设计文档，合法引用禁用词做规则定义与风险分析；
 *   - `node_modules/` / `dist/`：依赖与构建产物，非交付文本。
 */
export const SCAN_EXCLUDED_DIRS = ['tests', 'scripts', 'docs', 'node_modules', 'dist'] as const;

const EXCLUDED_SET: readonly string[] = SCAN_EXCLUDED_DIRS;

function isScannableFile(abs: string): boolean {
  return SCAN_EXTENSIONS.some((ext) => abs.endsWith(ext));
}

/** 路径中任一目录段命中排除项 → 排除（repoRel 为相对仓库根的路径） */
function isExcluded(abs: string, repoRoot: string): boolean {
  const rel = path.relative(repoRoot, abs).split(path.sep);
  return rel.some((segment) => EXCLUDED_SET.includes(segment));
}

/**
 * 递归列出目录（或单个文件）下所有可扫描文件（仅后缀过滤，**不应用排除项**）。
 * 供「自证」类测试强制扫描 fixture 目录使用；正式扫描范围请用 `collectScanFiles`。
 */
export function listFilesUnder(absDirOrFile: string): string[] {
  if (!fs.existsSync(absDirOrFile)) return [];
  if (fs.statSync(absDirOrFile).isFile()) {
    return isScannableFile(absDirOrFile) ? [absDirOrFile] : [];
  }
  const acc: string[] = [];
  for (const entry of fs.readdirSync(absDirOrFile, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    acc.push(...listFilesUnder(path.join(absDirOrFile, entry.name)));
  }
  return acc;
}

/** 收集门禁**实际扫描**的文件（应用 `SCAN_ROOTS` / `SCAN_FILES` / `SCAN_EXCLUDED_DIRS`） */
export function collectScanFiles(repoRoot: string): string[] {
  const out: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of listFilesUnder(path.resolve(repoRoot, root))) {
      if (!isExcluded(file, repoRoot)) out.push(file);
    }
  }
  for (const rel of SCAN_FILES) {
    const abs = path.resolve(repoRoot, rel);
    if (fs.existsSync(abs) && isScannableFile(abs) && !isExcluded(abs, repoRoot)) {
      out.push(abs);
    }
  }
  return out;
}

/** 逐行扫描文本，返回命中行描述（`label:lineNo: [pattern] 内容`） */
export function scanText(text: string, label: string): string[] {
  const hits: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const matched = firstForbiddenMatch(line);
    if (matched) {
      hits.push(`${label}:${index + 1}: [${matched}] ${line.trim().slice(0, 120)}`);
    }
  });
  return hits;
}

/** 扫描单个文件 */
export function scanFile(abs: string, repoRoot: string): string[] {
  return scanText(fs.readFileSync(abs, 'utf8'), path.relative(repoRoot, abs));
}

/** 执行完整门禁：返回被扫描文件清单与命中清单 */
export function runGate(repoRoot: string): { files: string[]; hits: string[] } {
  const files = collectScanFiles(repoRoot);
  const hits = files.flatMap((file) => scanFile(file, repoRoot));
  return { files, hits };
}
