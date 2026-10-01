/**
 * scripts/verify-papers.ts —— 套卷构建期门禁（docs/02 §3.6 / docs/04 §5.7.3）。
 *
 * ★ 与运行时断言的分工：
 *   - 本文件 = **构建期**门禁，CI 里跑，拦住"产物已经生成但有问题"；
 *   - `src/data/sources/BuiltinPaperSource.assertNoAudioFields` = **运行时**第二道防线，
 *     拦住"有人绕过管线直接往 public/data 塞文件"。
 *   两处**刻意各写一份**（不共享实现）：它们在不同阶段执行、依赖不同，
 *   共享反而会让"改一处同时削弱两道闸门"。音频字段收集逻辑两边保持一致即可。
 *
 * 运行：pnpm tsx scripts/verify-papers.ts [目录]
 * 退出码：有 error 级问题时 1，否则 0。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstForbiddenMatch } from './forbidden-words';
import type { PaperBundle } from '../src/data/sources/PaperSource';

export interface PaperIssue {
  level: 'error' | 'warn';
  code: string;
  paperId: string;
  message: string;
}

/** 递归收集非空值的 `audio*` 字段路径（与运行时断言逻辑保持一致） */
export function collectAudioKeys(value: unknown, at = '', out: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectAudioKeys(item, `${at}[${i}]`, out));
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = at === '' ? key : `${at}.${key}`;
    if (/^audio/i.test(key)) {
      if (child !== undefined) out.push(next);
      continue;
    }
    collectAudioKeys(child, next, out);
  }
  return out;
}

/** 自撰字段过禁用词门禁（docs/04 §5.7.3：只守"我们写的文案"，不扫语料全文） */
function checkAuthoredText(bundle: PaperBundle, issues: PaperIssue[]): void {
  const { paper } = bundle;
  const fields: Array<[string, string | undefined]> = [
    ['provenanceLabel', paper.provenanceLabel],
    ['confidence.note', paper.confidence?.note],
    ['derivedFrom', paper.derivedFrom],
  ];
  for (const [name, text] of fields) {
    if (!text) continue;
    const hit = firstForbiddenMatch(text);
    if (hit) {
      issues.push({
        level: 'error',
        code: 'FORBIDDEN_WORD',
        paperId: paper.id,
        message: `自撰字段 ${name} 命中禁用词 [${hit}]：${text}`,
      });
    }
  }
}

function checkSectionMeta(bundle: PaperBundle, issues: PaperIssue[]): void {
  const { paper } = bundle;
  const meta = [...paper.sectionMeta].sort((a, b) => a.order - b.order);

  if (meta.length === 0) {
    issues.push({ level: 'error', code: 'NO_SECTIONS', paperId: paper.id, message: 'sectionMeta 为空' });
    return;
  }

  // order 必须唯一且严格递增
  const orders = meta.map((m) => m.order);
  if (new Set(orders).size !== orders.length) {
    issues.push({ level: 'error', code: 'DUP_ORDER', paperId: paper.id, message: `sectionMeta.order 重复：${orders.join(',')}` });
  }

  // 题号区间合法且互不重叠
  for (const m of meta) {
    if (m.questionFrom > m.questionTo) {
      issues.push({
        level: 'error',
        code: 'BAD_RANGE',
        paperId: paper.id,
        message: `${m.kind} 题号区间非法：${m.questionFrom} > ${m.questionTo}`,
      });
    }
  }
  for (let i = 1; i < meta.length; i += 1) {
    const prev = meta[i - 1]!;
    const cur = meta[i]!;
    if (cur.questionFrom <= prev.questionTo) {
      issues.push({
        level: 'error',
        code: 'RANGE_OVERLAP',
        paperId: paper.id,
        message: `题号区间重叠：${prev.kind}(${prev.questionFrom}-${prev.questionTo}) 与 ${cur.kind}(${cur.questionFrom}-${cur.questionTo})`,
      });
    }
  }
}

function checkQuestions(bundle: PaperBundle, issues: PaperIssue[]): void {
  const { paper, questions } = bundle;
  const meta = paper.sectionMeta;

  const seen = new Set<number>();
  for (const q of questions) {
    if (seen.has(q.no)) {
      issues.push({ level: 'error', code: 'DUP_QNO', paperId: paper.id, message: `题号重复：${q.no}` });
    }
    seen.add(q.no);

    const inRange = meta.some((m) => q.no >= m.questionFrom && q.no <= m.questionTo);
    if (!inRange) {
      issues.push({
        level: 'error',
        code: 'QNO_OUT_OF_RANGE',
        paperId: paper.id,
        message: `题 ${q.id} 的 no=${q.no} 落不到任何 sectionMeta 区间内`,
      });
    }

    // 客观题必须有答案，否则 grader 会把它当主观题，正确率分母被悄悄吃掉
    const isSubjective = q.kind === 'essay' || q.kind === 'translation';
    if (!isSubjective && (q.answer === undefined || q.answer.trim() === '')) {
      issues.push({
        level: 'error',
        code: 'MISSING_ANSWER',
        paperId: paper.id,
        message: `客观题 ${q.id} 缺少 answer（会被 grader 排除出分母）`,
      });
    }
  }

  // 启用板块内的客观题数量： reading 区间里一道题都没有 → 结果页全是空，属 warn
  const disabled = new Set(['listening']);
  for (const m of meta) {
    if (disabled.has(m.kind)) continue;
    const count = questions.filter(
      (q) => q.no >= m.questionFrom && q.no <= m.questionTo && q.answer !== undefined,
    ).length;
    if (count === 0 && m.kind === 'reading') {
      issues.push({
        level: 'warn',
        code: 'NO_OBJECTIVE',
        paperId: paper.id,
        message: `板块 ${m.kind} 内没有客观题 —— 结果页将无正确率可展示`,
      });
    }
  }
}

/** 校验一套卷，返回问题清单（空数组 = 通过） */
export function verifyPaper(bundle: PaperBundle): PaperIssue[] {
  const issues: PaperIssue[] = [];
  const { paper } = bundle;

  if (!paper?.id) {
    return [{ level: 'error', code: 'NO_ID', paperId: '(unknown)', message: 'paper.id 缺失' }];
  }

  // ① 铁律 A6：音频零入库
  const audioKeys = collectAudioKeys(bundle);
  if (audioKeys.length > 0) {
    issues.push({
      level: 'error',
      code: 'A6_AUDIO_FIELD',
      paperId: paper.id,
      message: `携带音频字段（铁律 A6）：${audioKeys.join('、')}`,
    });
  }
  if (paper.provenance === 'original' && paper.confidence?.hasAudio === true) {
    issues.push({
      level: 'error',
      code: 'A6_HAS_AUDIO',
      paperId: paper.id,
      message: "provenance='original' 的卷 confidence.hasAudio 必须为 false",
    });
  }

  // ② 来源与置信度必须显式标注（A7）
  if (paper.provenance !== 'original' && paper.provenance !== 'derived' && paper.provenance !== 'user-imported') {
    issues.push({ level: 'error', code: 'BAD_PROVENANCE', paperId: paper.id, message: `provenance 非法：${String(paper.provenance)}` });
  }
  if (!paper.provenanceLabel) {
    issues.push({ level: 'error', code: 'NO_LABEL', paperId: paper.id, message: '缺少 provenanceLabel（A7 要求 UI 展示来源）' });
  }
  if (!paper.confidence) {
    issues.push({ level: 'error', code: 'NO_CONFIDENCE', paperId: paper.id, message: '缺少 confidence（A7）' });
  }
  if (paper.provenance === 'derived' && !paper.derivedFrom) {
    issues.push({ level: 'warn', code: 'NO_DERIVED_FROM', paperId: paper.id, message: 'derived 卷建议声明 derivedFrom 语料基准' });
  }

  checkAuthoredText(bundle, issues);
  checkSectionMeta(bundle, issues);
  checkQuestions(bundle, issues);

  return issues;
}

/** 校验一批卷 */
export function verifyPapers(bundles: readonly PaperBundle[]): PaperIssue[] {
  return bundles.flatMap(verifyPaper);
}

/**
 * 目录里的非套卷文件（跳过，否则会被当成"缺 id 的坏卷"误报）。
 * `_` 前缀 = 说明/草稿；`index.json` / `manifest.json` = 目录与清单。
 */
const NON_BUNDLE_FILES = new Set(['index.json', 'manifest.json']);

/** 从目录读取所有套卷 *.json */
export function readBundlesFromDir(dir: string): PaperBundle[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_') && !NON_BUNDLE_FILES.has(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as PaperBundle);
}

/** 是否被直接执行（为 true 时才跑 CLI；被 import 时只暴露纯函数，避免副作用） */
export function isDirectRun(): boolean {
  const entry = process.argv[1] ?? '';
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export const DEFAULT_PAPER_DIRS: string[] = [
  path.join(process.cwd(), 'scripts', 'data', 'authored', 'papers'),
  path.join(process.cwd(), 'scripts', 'data', 'raw', 'papers'),
];

export function main(): void {
  const dirs = process.argv.slice(2);
  const list = dirs.length > 0 ? dirs : DEFAULT_PAPER_DIRS;
  const bundles = list.flatMap((d) => readBundlesFromDir(d));

  if (bundles.length === 0) {
    console.log(`[verify-papers] 目录 ${list.join('、')} 下没有套卷，跳过。`);
    return;
  }

  const issues = verifyPapers(bundles);
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  console.log(`[verify-papers] 校验 ${bundles.length} 套卷：`);
  for (const b of bundles) {
    const q = b.questions?.length ?? 0;
    console.log(`  · ${b.paper.id}（${b.paper.provenance}，${q} 题）`);
  }

  for (const w of warns) console.warn(`  ⚠ [${w.code}] ${w.paperId}: ${w.message}`);
  for (const e of errors) console.error(`  ✗ [${e.code}] ${e.paperId}: ${e.message}`);

  if (errors.length > 0) {
    console.error(`[verify-papers] ✗ ${errors.length} 个 error，${warns.length} 个 warn。`);
    process.exit(1);
  }
  console.log(`[verify-papers] ✓ 通过（${warns.length} 个 warn）。`);
}

// ★ 只在被直接执行时跑 CLI：build-papers.ts 会 import 本文件的纯函数，
//   若顶层无条件调用 main()，那条管线会莫名其妙多打一份校验日志。
if (isDirectRun()) main();
