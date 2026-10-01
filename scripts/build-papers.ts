/**
 * scripts/build-papers.ts —— 套卷管线（T-M2-02）。
 *
 * ★ 铁律 A4 的落点：**内置卷与将来的 `original` 语料走同一条管线**。
 *   现在内置的是 `derived`（内容自撰）；等 `original` 语料就位，
 *   只需把 raw JSON 放进 `scripts/data/raw/papers/`，**本文件一行都不用改**。
 *
 * ★ 不做的事：
 *   - **不抓取、不复制**任何受著作权保护的真题原文（语料必须由外部提供）；
 *   - 只做「读源 → 校验 → 产出」，产物附来源与置信度标注（A7）。
 *
 * ★ 两个源目录（刻意分家，见 .gitignore）：
 *   - `scripts/data/authored/papers/` —— **自撰**卷，入库。克隆后 `data:papers` 可重跑。
 *   - `scripts/data/raw/papers/`      —— 外部提供的语料，**不入库**（.gitignore）。
 *     等 `original` 语料就位，丢进这个目录即可，本文件一行都不用改。
 *
 * 运行：pnpm tsx scripts/build-papers.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PaperBundle, PaperSummary, PapersIndexFile } from '../src/data/sources/PaperSource';
import { OUT_DIR, RAW_DIR, ROOT_DIR, ensureDir, formatBytes, writeJson } from './lib/pipeline';
import { readBundlesFromDir, verifyPapers } from './verify-papers';

/** 自撰卷（入库，可重跑） */
const AUTHORED_PAPERS_DIR = path.join(ROOT_DIR, 'scripts', 'data', 'authored', 'papers');
/** 外部语料（.gitignore，绝不入库） */
const RAW_PAPERS_DIR = path.join(RAW_DIR, 'papers');
const OUT_PAPERS_DIR = path.join(OUT_DIR, 'papers');

function toSummary(bundle: PaperBundle): PaperSummary {
  const { paper } = bundle;
  return {
    id: paper.id,
    year: paper.year,
    month: paper.month,
    setNo: paper.setNo,
    provenance: paper.provenance,
    provenanceLabel: paper.provenanceLabel,
    questionCount: bundle.questions?.length ?? 0,
    // 铁律 A6：仓库内永不携带音频 —— 恒定 false，不是"当前恰好没配"
    hasAudio: false,
    confidenceLevel: paper.confidence?.level ?? 'low',
  };
}

async function main(): Promise<void> {
  const bundles = [...readBundlesFromDir(AUTHORED_PAPERS_DIR), ...readBundlesFromDir(RAW_PAPERS_DIR)];

  if (bundles.length === 0) {
    console.log(`[build-papers] ${AUTHORED_PAPERS_DIR} 与 ${RAW_PAPERS_DIR} 下都没有套卷，跳过。`);
    return;
  }

  // 两个目录出现同 id → 后者静默覆盖前者，产物不可预期，直接掐死
  const seen = new Map<string, string>();
  for (const b of bundles) {
    const prev = seen.get(b.paper.id);
    if (prev) {
      throw new Error(`套卷 id 冲突：${b.paper.id} 同时出现在 ${prev} 与其它源目录，请只保留一处。`);
    }
    seen.set(b.paper.id, b.paper.id);
  }

  // ★ 门禁前置：有问题就不产出，绝不生成"带病"的产物
  const issues = verifyPapers(bundles);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    for (const e of errors) console.error(`[build-papers] ✗ [${e.code}] ${e.paperId}: ${e.message}`);
    throw new Error(`套卷校验未通过（${errors.length} 个 error），已中止产出。`);
  }
  for (const w of issues.filter((i) => i.level === 'warn')) {
    console.warn(`[build-papers] ⚠ [${w.code}] ${w.paperId}: ${w.message}`);
  }

  await ensureDir(OUT_PAPERS_DIR);

  // 清理上一轮残留（raw 里删掉的卷，产物也必须消失，否则 UI 会列出已不存在的卷）
  const keep = new Set(bundles.map((b) => `${b.paper.id}.json`));
  for (const file of fs.readdirSync(OUT_PAPERS_DIR)) {
    if (file.endsWith('.json') && file !== 'index.json' && !keep.has(file)) {
      fs.rmSync(path.join(OUT_PAPERS_DIR, file));
      console.log(`[build-papers] 移除残留产物 ${file}`);
    }
  }

  let bytes = 0;
  for (const bundle of bundles) {
    const out = path.join(OUT_PAPERS_DIR, `${bundle.paper.id}.json`);
    const { bytes: b } = await writeJson(out, bundle);
    bytes += b;
    console.log(
      `[build-papers] ${bundle.paper.id}（${bundle.paper.provenance}，` +
        `${bundle.questions?.length ?? 0} 题）→ ${formatBytes(b)}`,
    );
  }

  const index: PapersIndexFile & { killSwitch: { disabled: boolean; reason?: string } } = {
    // 铁律 A6：音频缺失是 100% 发生的常态，不是异常（docs/02 §3.6.2）
    defaultMissingAudio: true,
    // 减损措施④：权利人提出异议时可整站下线（docs/02 §3.6.5）
    killSwitch: { disabled: false },
    papers: bundles.map(toSummary),
  };
  const { bytes: ib } = await writeJson(path.join(OUT_PAPERS_DIR, 'index.json'), index);
  bytes += ib;

  console.log(`[build-papers] 已产出 ${bundles.length} 套卷 + index.json，合计 ${formatBytes(bytes)}`);
}

main().catch((error: unknown) => {
  console.error('[build-papers] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
