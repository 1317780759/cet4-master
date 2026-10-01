/**
 * scripts/check-forbidden-words.ts —— CI 门禁：禁用词检查。
 *
 * 运行：pnpm tsx scripts/check-forbidden-words.ts
 * 退出码：有命中时 1，否则 0。
 *
 * ★ 规则单一真源在 `scripts/forbidden-words.ts`（本脚本只负责调用与报告，不重写正则）。
 *   依赖方向：本脚本 → scripts/forbidden-words.ts（**不**依赖 tests/**）。
 *
 * 扫描范围（对外可见 / 随包分发，docs/04 §5.7.1）：
 *   - `src/**`
 *   - `README.md`
 *   - `public/data/ATTRIBUTION.md`
 * 排除 `tests/`、`scripts/`、`docs/` 等（原因见 `SCAN_EXCLUDED_DIRS` 注释）：
 *   回归 fixture 与规则文件**必然含禁用词串**，进入范围会命中自己。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGate, SCAN_FILES, SCAN_ROOTS } from './forbidden-words';

/** 仓库根 = scripts/ 的上一级 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main(): void {
  const { files, hits } = runGate(REPO_ROOT);

  console.log('[forbidden-words] 扫描范围：');
  console.log(`  · 递归目录：${SCAN_ROOTS.map((r) => `${r}/**`).join(', ')}`);
  console.log(`  · 指定文件：${SCAN_FILES.join(', ')}`);
  console.log(`  共 ${files.length} 个文件。`);

  if (hits.length > 0) {
    console.error(`[forbidden-words] ✗ 命中 ${hits.length} 处禁用词：`);
    for (const hit of hits) console.error(`  ${hit}`);
    process.exit(1);
  }

  console.log('[forbidden-words] ✓ 对外可见产物零命中。');
}

main();
