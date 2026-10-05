/**
 * scripts/build-phonetics.ts —— 音标数据管线（需求 1：单词下方显示音标）。
 *
 * ★ 数据源：ipa-dict（MIT）单源。
 *   - en_UK.txt（1,684,124 B / 65,119 条）、en_US.txt（3,180,267 B / 125,927 条）
 *   - 格式 `词条\t/IPA/`，同行多个发音用 `,` 或 `;` 分隔 —— 取第一个
 *   - ECDICT 已实测否决：只有一列 phonetic、不区分英美音、65.9 MB，无收益
 *
 * ★ 两条环境约束（实测，不遵守会卡死）：
 *   1. 下载必须绕过本机代理 127.0.0.1:58916 —— 走代理时 raw.githubusercontent.com 返回 000/502
 *   2. 带宽仅约 15 KB/s（两个文件各约 112 秒）—— 源文件缓存进 scripts/data/raw/phonetics/，
 *      「本地有则直接用、无则下载」，绝不每次构建重下
 *
 * ★ 一个必须处理的真实数据缺陷：
 *   ipa-dict 的 en_UK.txt 缺一批极高频词（a / have / as / he / do / use / read / no / job /
 *   minute / live 等，有 jobber/jobbing 却没有 job）。因此「跨方言回退」不是优化而是必需项，
 *   且必须用 src 标记位区分原生与借用 —— 拿美音冒充英音是静默的错误教学。
 *
 * ★ 不做词形还原：实测加 -s/-es/-ing/-ed 等还原只多覆盖 0.34pp，却会把 read 这类词读错音。
 *
 * 运行：pnpm tsx scripts/build-phonetics.ts
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  GENERATED_DIR,
  OUT_DIR,
  RAW_DIR,
  ROOT_DIR,
  ensureDir,
  exists,
  formatBytes,
  readJson,
  readText,
  sha256,
  versionDateKey,
  writeJson,
  writeText,
} from './lib/pipeline';
import { type PhoneticsIssue, verifyPhonetics } from './verify-phonetics';

const TAG = '[build-phonetics]';

const RAW_PHONETICS_DIR = path.join(RAW_DIR, 'phonetics');
const AUTHORED_PHONETICS_DIR = path.join(ROOT_DIR, 'scripts', 'data', 'authored', 'phonetics');
const OUT_PHONETICS_DIR = path.join(OUT_DIR, 'phonetics');

const INDEX_FILE = path.join(OUT_PHONETICS_DIR, 'index.json');
const CORE_FILE = path.join(OUT_PHONETICS_DIR, 'phonetics.core.json');
const FULL_FILE = path.join(OUT_PHONETICS_DIR, 'phonetics.full.json');

const SOURCES = [
  {
    file: 'en_UK.txt',
    url: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_UK.txt',
    dialect: 'uk' as const,
  },
  {
    file: 'en_US.txt',
    url: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt',
    dialect: 'us' as const,
  },
];

/** src 标记位语义（与 verify-phonetics.ts 保持一致） */
const SRC = { native: 0, partial: 1, manual: 2, missing: 3 } as const;

interface FetchedMeta {
  [file: string]: { sha256: string; bytes: number; fetchedAt: string; url: string };
}

interface WordIndexFile {
  version: string;
  count: number;
  rows: Array<{ id: string; w: string; r: number; t: number; c: number; f: number }>;
}

interface ManifestFile {
  coreBoundary: number;
}

interface ManualFile {
  items: Array<{ w: string; uk?: string; us?: string }>;
}

/**
 * 下载单个源文件。
 * env 里显式清掉代理变量 + curl 加 --noproxy '*' —— 双保险，因为本机代理对
 * raw.githubusercontent.com 的 CONNECT 会返回 502（实测）。
 */
function download(file: string, url: string, dest: string): void {
  const env = { ...process.env };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete env[key];
  }
  console.log(`${TAG} 下载 ${file}（带宽约 15 KB/s，请耐心等待 1–2 分钟）…`);
  const r = spawnSync('curl', ['--noproxy', '*', '-sSL', '--fail', '-o', dest, url], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
    // 单文件约 2 分钟，留足余量
    timeout: 600_000,
  });
  if (r.status !== 0) {
    const stderr = String(r.stderr ?? '').trim();
    throw new Error(
      `下载 ${url} 失败（exit=${r.status}）${stderr ? `：${stderr}` : ''}。` +
        `若网络受限，可手动把 ${file} 放到 ${RAW_PHONETICS_DIR}。`,
    );
  }
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    throw new Error(`下载 ${url} 得到空文件，请检查网络后重试。`);
  }
}

async function ensureSources(): Promise<FetchedMeta> {
  await ensureDir(RAW_PHONETICS_DIR);
  const metaPath = path.join(RAW_PHONETICS_DIR, '.fetched.json');
  const meta: FetchedMeta = (await exists(metaPath))
    ? ((await readJson(metaPath)) as FetchedMeta)
    : {};

  for (const src of SOURCES) {
    const dest = path.join(RAW_PHONETICS_DIR, src.file);
    if (await exists(dest)) {
      const buf = fs.readFileSync(dest);
      if (buf.length === 0) throw new Error(`${dest} 是空文件，请删除后重试。`);
      meta[src.file] = {
        sha256: sha256(buf),
        bytes: buf.length,
        fetchedAt: meta[src.file]?.fetchedAt ?? new Date(0).toISOString(),
        url: src.url,
      };
      console.log(`${TAG} 复用缓存 ${src.file}（${formatBytes(buf.length)}）`);
      continue;
    }
    download(src.file, src.url, dest);
    const buf = fs.readFileSync(dest);
    meta[src.file] = {
      sha256: sha256(buf),
      bytes: buf.length,
      fetchedAt: new Date().toISOString(),
      url: src.url,
    };
    console.log(`${TAG} 已下载 ${src.file}（${formatBytes(buf.length)}）`);
  }

  await writeJson(metaPath, meta);
  return meta;
}

/** 解析 ipa-dict 的 `词条\t/IPA/` 文本 → Map<小写词条, 音标（已去斜杠）> */
function parseIpaDict(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const key = line.slice(0, tab).trim().toLowerCase();
    if (!key) continue;
    const raw = line.slice(tab + 1).trim();
    if (!raw) continue;
    // 同一行多个发音用 , 或 ; 分隔 —— 取第一个
    const first = raw.split(/[,;]/)[0].trim();
    // 去掉首尾的 /（纯装饰，运行时显示时再加回去）
    const ipa = first.replace(/^\/+/, '').replace(/\/+$/, '').trim();
    if (!ipa) continue;
    // 首次出现优先（文件大体有序，靠前的通常是更常用的读音）
    if (!map.has(key)) map.set(key, ipa);
  }
  return map;
}

async function main(): Promise<void> {
  const meta = await ensureSources();

  const uk = parseIpaDict(await readText(path.join(RAW_PHONETICS_DIR, 'en_UK.txt')));
  const us = parseIpaDict(await readText(path.join(RAW_PHONETICS_DIR, 'en_US.txt')));
  console.log(`${TAG} 词典条目：UK ${uk.size} / US ${us.size}`);

  // 人工补录（ipa-dict 两侧都缺的词，实测仅 14 个）
  const manualPath = path.join(AUTHORED_PHONETICS_DIR, 'manual.json');
  const manual = new Map<string, { uk?: string; us?: string }>();
  if (await exists(manualPath)) {
    const mf = (await readJson(manualPath)) as ManualFile;
    for (const it of mf.items ?? []) {
      manual.set(it.w.trim().toLowerCase(), { uk: it.uk, us: it.us });
    }
  }
  console.log(`${TAG} 人工补录 ${manual.size} 条`);

  // 词表：只读，绝不修改（改了会让老用户重灌 2.5 MB 词库 —— P0 禁令 G3）
  const indexFile = (await readJson(path.join(OUT_DIR, 'words.index.full.json'))) as WordIndexFile;
  const rows = indexFile.rows;
  const manifest = (await readJson(path.join(OUT_DIR, 'manifest.json'))) as ManifestFile;
  const coreBoundary = manifest.coreBoundary ?? 2104;
  console.log(`${TAG} 词表 ${rows.length} 词，core 边界 ${coreBoundary}`);

  const missed: string[] = [];
  let nativeCount = 0;
  let partialCount = 0;
  let manualCount = 0;

  const buildRow = (row: (typeof rows)[number]): [string, string, string, number] => {
    const key = row.w.trim().toLowerCase();
    const m = manual.get(key);
    if (m?.uk || m?.us) {
      manualCount++;
      return [row.id, m.uk ?? '', m.us ?? '', SRC.manual];
    }
    const nativeUk = uk.get(key);
    const nativeUs = us.get(key);
    if (nativeUk && nativeUs) {
      nativeCount++;
      return [row.id, nativeUk, nativeUs, SRC.native];
    }
    // ★ 刻意不做「跨方言冒充」：缺哪一侧就留空，绝不用美音填充英音栏位。
    //   拿美音冒充英音是静默的错误教学 —— 用户看到的是缺一项，而不是错一项。
    //   UI 侧会把仅存的一侧照常显示，并按真实方言标注。
    if (nativeUk || nativeUs) {
      partialCount++;
      return [row.id, nativeUk ?? '', nativeUs ?? '', SRC.partial];
    }
    missed.push(row.w);
    return [row.id, '', '', SRC.missing];
  };

  const allRows = rows.map(buildRow);
  const coreRows = allRows.slice(0, coreBoundary);

  const covered = allRows.filter((r) => r[1] !== '' || r[2] !== '').length;
  const coverage = covered / allRows.length;
  const coreCovered = coreRows.filter((r) => r[1] !== '' || r[2] !== '').length;
  const coreCoverage = coreCovered / coreRows.length;

  console.log(
    `${TAG} 覆盖率：full ${(coverage * 100).toFixed(2)}%（${covered}/${allRows.length}），` +
      `core ${(coreCoverage * 100).toFixed(2)}%（${coreCovered}/${coreRows.length}）`,
  );
  console.log(
    `${TAG} 来源构成：双方言原生 ${nativeCount} / 仅一侧 ${partialCount} / 人工 ${manualCount} / 缺失 ${missed.length}`,
  );

  // ★ 门禁前置：有问题就不产出（与 build-papers.ts 同一纪律）
  const issues: PhoneticsIssue[] = verifyPhonetics({
    rows: allRows,
    coreRows,
    coverage,
    coreCoverage,
  });
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    for (const e of errors) console.error(`${TAG} ✗ [${e.code}] ${e.message}`);
    throw new Error(`音标校验未通过（${errors.length} 个 error），已中止产出。`);
  }
  for (const w of issues.filter((i) => i.level === 'warn')) {
    console.warn(`${TAG} ⚠ [${w.code}] ${w.message}`);
  }

  const version = `${versionDateKey()}.${sha256(JSON.stringify(allRows)).slice(0, 8)}`;
  await ensureDir(OUT_PHONETICS_DIR);

  // 数据密集文件用紧凑写法（2 空格缩进会让体积膨胀近一倍，实测差 ~100 KB）
  const writeScope = async (file: string, list: typeof allRows, count: number) => {
    const text = `${JSON.stringify({ version, count, rows: list })}\n`;
    const bytes = await writeText(file, text);
    return { bytes, sha256: sha256(text) };
  };

  const core = await writeScope(CORE_FILE, coreRows, coreRows.length);
  const full = await writeScope(FULL_FILE, allRows, allRows.length);

  await writeJson(INDEX_FILE, {
    version,
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-phonetics.ts',
    sourceId: 'ipa-dict',
    coverage: { core: Number(coreCoverage.toFixed(4)), full: Number(coverage.toFixed(4)) },
    scopes: {
      core: { file: 'phonetics/phonetics.core.json', sha256: core.sha256, count: coreRows.length, bytes: core.bytes },
      full: { file: 'phonetics/phonetics.full.json', sha256: full.sha256, count: allRows.length, bytes: full.bytes },
    },
    licenseNote:
      '本文件由 ipa-dict（MIT）派生；其英语词条源自 Wiktionary（CC BY-SA 4.0）。' +
      '本文件与 public/data/words/*.json（CC BY-NC-SA 4.0）为并列聚合，各自保留原许可，不构成相互改编。',
    source: [
      {
        sourceId: 'ipa-dict',
        name: 'ipa-dict (open-dict-data)',
        url: 'https://github.com/open-dict-data/ipa-dict',
        license: 'MIT',
        licenseUrl: 'https://github.com/open-dict-data/ipa-dict/blob/master/LICENSE',
        commercialUse: true,
        fetchedAt: meta['en_UK.txt']?.fetchedAt ?? new Date().toISOString(),
        upstreamRef: 'master',
      },
    ],
  });

  console.log(
    `${TAG} 产物：core ${formatBytes(core.bytes)} / full ${formatBytes(full.bytes)} / index.json`,
  );

  // miss 清单（便于追踪，不入库）
  await ensureDir(GENERATED_DIR);
  await writeText(
    path.join(GENERATED_DIR, 'phonetics-miss.md'),
    [
      `# 音标未覆盖词（${missed.length} / ${allRows.length}）`,
      '',
      `覆盖率 ${(coverage * 100).toFixed(2)}%`,
      '',
      ...(missed.length ? missed.map((w) => `- ${w}`) : ['（无）']),
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error(`${TAG} 失败：`, error instanceof Error ? error.message : error);
  process.exit(1);
});
