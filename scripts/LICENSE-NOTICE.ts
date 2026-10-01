/**
 * scripts/LICENSE-NOTICE.ts —— 生成 public/data/ATTRIBUTION.md
 *
 * ★ C5 合规要求：数据来源署名 + License 声明必须随数据一起分发，
 *   并在站点可见位置展示。本脚本从 manifest.json 读取真实溯源信息，
 *   保证「声明」与「实际数据」永远一致（不手写、不漂移）。
 *
 * 运行：pnpm data:attribution
 */

import path from 'node:path';
import type { DataManifest } from '../src/data/types';
import { OUT_DIR, exists, readJson, writeText } from './lib/pipeline';

/** 运行时依赖的许可记录（与 docs/依赖许可记录.md 保持一致） */
const CODE_LICENSES: Array<{ name: string; license: string; url: string; note: string }> = [
  {
    name: 'ts-fsrs',
    license: 'MIT',
    url: 'https://github.com/open-spaced-repetition/ts-fsrs',
    note: 'FSRS 间隔重复调度算法（npm / Snyk / jsDelivr 三方核实一致），本仓库锁定 5.4.2',
  },
  {
    name: 'react / react-dom',
    license: 'MIT',
    url: 'https://github.com/facebook/react',
    note: 'UI 运行时',
  },
  {
    name: 'dexie',
    license: 'Apache-2.0',
    url: 'https://github.com/dexie/Dexie.js',
    note: 'IndexedDB 封装',
  },
  {
    name: 'zustand',
    license: 'MIT',
    url: 'https://github.com/pmndrs/zustand',
    note: '状态镜像',
  },
  {
    name: 'react-router-dom',
    license: 'MIT',
    url: 'https://github.com/remix-run/react-router',
    note: '路由',
  },
  {
    name: 'clsx',
    license: 'MIT',
    url: 'https://github.com/lukeed/clsx',
    note: 'className 拼接',
  },
  {
    name: 'tailwindcss',
    license: 'MIT',
    url: 'https://github.com/tailwindlabs/tailwindcss',
    note: '样式（v4，CSS-first）',
  },
  {
    name: 'vite / vitest / tsx / typescript / eslint',
    license: 'MIT / Apache-2.0',
    url: 'https://github.com/vitejs/vite',
    note: '构建与测试工具链',
  },
];

async function main(): Promise<void> {
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  if (!(await exists(manifestPath))) {
    throw new Error('缺少 public/data/manifest.json —— 请先执行 pnpm data:build');
  }
  const manifest = await readJson<DataManifest>(manifestPath);
  const a = manifest.attribution;

  const lines: string[] = [];
  lines.push('# 数据来源与许可声明（ATTRIBUTION）');
  lines.push('');
  lines.push(`本目录下的词库数据**并非本站原创**，来自以下开源项目。`);
  lines.push('');
  lines.push('## 一、词库数据');
  lines.push('');
  lines.push('| 项 | 内容 |');
  lines.push('|---|---|');
  lines.push(`| 数据源 | [${a.name}](${a.url}) |`);
  lines.push(`| 数据源标识 | \`${a.sourceId}\` |`);
  lines.push(`| 上游版本锚点 | \`${a.upstreamRef}\`${a.fetchedAt ? `（抓取于 ${a.fetchedAt}）` : ''} |`);
  lines.push(`| **许可协议** | **${a.license}**（[全文](${a.licenseUrl})） |`);
  lines.push(`| 商用 | **${a.commercialUse ? '允许' : '❌ 禁止'}** |`);
  lines.push(`| 词条数 | ${manifest.wordCount}（高频核心 Top ${manifest.coreBoundary}：${manifest.coreCount}） |`);
  lines.push(`| 数据版本 | \`${manifest.version}\` |`);
  lines.push('');
  lines.push('### 非商用声明（必读）');
  lines.push('');
  lines.push(
    `本站词库衍生自 ${a.name}，该数据以 **${a.license}** 协议共享。` +
      '按该协议要求：',
  );
  lines.push('');
  lines.push('- **署名（BY）**：必须保留上述数据源标识与许可信息 —— 已在本文件与站点页脚体现；');
  lines.push('- **非商业性使用（NC）**：**不得用于任何商业目的**，包括但不限于付费课程、收费 App、广告变现；');
  lines.push('- **相同方式共享（SA）**：若再分发或改编本数据，必须以同一协议（CC BY-NC-SA 4.0）共享。');
  lines.push('');
  lines.push('> 本站点为**个人学习用途的非商业项目**：无账号、无后端、无付费、无广告，');
  lines.push('> 所有学习进度仅保存在使用者本机浏览器（IndexedDB），不会上传到任何服务器。');
  lines.push('');
  lines.push('### 统计口径说明');
  lines.push('');
  lines.push(
    `上游数据的排序依据是约 200 套四六级 / 考研 / 专四专八试卷文本中的**实际词频**，` +
      `前 ${manifest.coreBoundary} 个单词出现 40 次以上（平均每 5 套卷必现）。`,
  );
  lines.push('本站仅据此重新编号（`freqRank`）与分档（`tier`），未改动原始释义与词表构成。');
  lines.push('');
  lines.push('## 二、真题材料');
  lines.push('');
  lines.push('- 本站**默认不分发任何受著作权保护的真题原文**（`provenance` 谱系见代码）；');
  lines.push('- 内置套卷为「真题同源模拟卷」（`derived`）：结构/考点取自公开考纲与真题语料统计，**内容自撰**；');
  lines.push('- 用户可自行导入 JSON 套卷，仅落本机 IndexedDB，**永不上传**；');
  lines.push(
    '- 🔴 **音频零入库**（架构铁律 A6）：仓库内不含任何 `.mp3/.m4a/.wav/.ogg/.flac/.aac` 文件，' +
      '真题原声需由用户自备音频源地址。',
  );
  lines.push('');
  lines.push('## 三、代码依赖许可');
  lines.push('');
  lines.push('| 依赖 | License | 说明 |');
  lines.push('|---|---|---|');
  for (const dep of CODE_LICENSES) {
    lines.push(`| [${dep.name}](${dep.url}) | ${dep.license} | ${dep.note} |`);
  }
  lines.push('');
  lines.push('## 四、反馈与下架');
  lines.push('');
  lines.push(
    '若你是上述内容的权利人，认为本站使用方式不妥，请通过仓库 Issue 联系我们，' +
      '我们将在核实后第一时间移除相关内容（代码内已预留 killSwitch 通道）。',
  );
  lines.push('');
  lines.push(`<!-- 本文件由 scripts/LICENSE-NOTICE.ts 自动生成，请勿手改。数据版本：${manifest.version} -->`);
  lines.push('');

  const bytes = await writeText(path.join(OUT_DIR, 'ATTRIBUTION.md'), lines.join('\n'));
  console.log(`[LICENSE-NOTICE] 已生成 public/data/ATTRIBUTION.md（${bytes} 字节）`);
  console.log(`  数据源：${a.sourceId} · ${a.license} · 非商用`);
}

main().catch((error: unknown) => {
  console.error('[LICENSE-NOTICE] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
