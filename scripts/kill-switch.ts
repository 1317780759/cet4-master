/**
 * scripts/kill-switch.ts —— 减损措施④ 的一键开关（T-M2-05）。
 *
 * 权利人提出异议时：**一条命令**整站下线内置卷，不需要改代码、不需要重新构建数据。
 *
 * 用法：
 *   pnpm tsx scripts/kill-switch.ts on  --reason "权利人提出异议，已停止分发"
 *   pnpm tsx scripts/kill-switch.ts off
 *   pnpm tsx scripts/kill-switch.ts status
 *
 * ★ 只改 `public/data/papers/index.json` 的 `killSwitch`：
 *   套卷文件与用户进度**一概不动** —— 解除开关即可恢复，无需重新导入。
 */

import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR, writeJson } from './lib/pipeline';
import type { PapersIndexFile } from '../src/data/sources/PaperSource';
import { applyKillSwitch, isKilled, killSwitchReason } from '../src/data/sources/killSwitch';

const INDEX_FILE = path.join(OUT_DIR, 'papers', 'index.json');

function readIndex(): PapersIndexFile {
  return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) as PapersIndexFile;
}

function printStatus(index: PapersIndexFile): void {
  const killed = isKilled(index);
  console.log(`[kill-switch] 套卷目录：${INDEX_FILE}`);
  console.log(`[kill-switch] 状态：${killed ? '⛔ 已下线' : '✅ 正常分发'}（${index.papers.length} 套）`);
  const reason = killSwitchReason(index);
  if (killed && reason) console.log(`[kill-switch] 原因：${reason}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = (args[0] ?? 'status').toLowerCase();
  const reasonIdx = args.indexOf('--reason');
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;

  if (command === 'status') {
    printStatus(readIndex());
    return;
  }

  if (command !== 'on' && command !== 'off') {
    console.error(`[kill-switch] 未知命令：${command}（可用：on / off / status）`);
    process.exit(1);
  }

  const current = readIndex();
  const next = applyKillSwitch(current, { disabled: command === 'on', reason });
  await writeJson(INDEX_FILE, next);
  printStatus(next);
  console.log(
    command === 'on'
      ? '[kill-switch] 已下线。套卷文件与用户进度未改动 —— 执行 `off` 即可恢复。'
      : '[kill-switch] 已恢复分发。',
  );
}

main().catch((error: unknown) => {
  console.error('[kill-switch] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
