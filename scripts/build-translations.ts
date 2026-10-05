/**
 * scripts/build-translations.ts —— 翻译训练语料管线。
 *
 * ★ 与 build-papers.ts 同纪律：
 *   - **门禁前置**：有 error 就打印后 throw，绝不产出"带病"产物；
 *   - **清理残留**：源里删掉的话题，产物也必须消失，否则 UI 会列出读不出的话题；
 *   - 只做「读源 → 校验 → 产出」，不改写语料内容。
 *
 * ★ 产物（public/data/translations/，运行时 fetch，**不进 JS bundle**）：
 *   - `index.json`     —— 话题目录（key / label / count），按 TRANSLATION_TOPIC_KEYS 顺序；
 *   - `<topicKey>.json` —— 单话题全部句子，items 顺序与源文件一致（不重排）。
 *
 * 运行：pnpm tsx scripts/build-translations.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TranslationTopicKey } from '../src/domain/translation/types';
import { TRANSLATION_TOPIC_KEYS, TRANSLATION_TOPIC_LABEL } from '../src/domain/translation/topics';
import type { TranslationsIndexFile } from '../src/data/sources/TranslationSource';
import { OUT_DIR, ROOT_DIR, ensureDir, formatBytes, writeJson } from './lib/pipeline';
import { readTranslationTopicFiles, verifyTranslations } from './verify-translations';

const TAG = '[build-translations]';

/** 自撰语料目录（入库，可重跑） */
const AUTHORED_TRANSLATIONS_DIR = path.join(
  ROOT_DIR,
  'scripts',
  'data',
  'authored',
  'translation',
);
/** 产物目录 */
const OUT_TRANSLATIONS_DIR = path.join(OUT_DIR, 'translations');

/** index.json 的实际写出形态 = 契约 + 管线元信息 */
type TranslationsIndexArtifact = TranslationsIndexFile & { generatedFrom: string };

async function main(): Promise<void> {
  const files = readTranslationTopicFiles(AUTHORED_TRANSLATIONS_DIR);

  if (files.length === 0) {
    console.log(`${TAG} ${AUTHORED_TRANSLATIONS_DIR} 下没有语料，跳过。`);
    return;
  }

  // 同一话题被两个文件命中 → 后者静默覆盖前者，直接掐死
  const seen = new Map<string, TranslationTopicKey>();
  for (const f of files) {
    const prev = seen.get(f.topic);
    if (prev !== undefined) {
      throw new Error(`${TAG} 话题 ${f.topic} 被多个源文件命中，请只保留一份。`);
    }
    seen.set(f.topic, f.topic);
  }

  // ★ 门禁前置：有问题就不产出
  const issues = verifyTranslations(files);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    for (const e of errors) {
      console.error(
        `${TAG} ✗ [${e.code}] ${e.topic ?? '-'}${e.itemId ? `/${e.itemId}` : ''}: ${e.message}`,
      );
    }
    throw new Error(`${TAG} 校验未通过（${errors.length} 个 error），已中止产出。`);
  }
  for (const w of issues.filter((i) => i.level === 'warn')) {
    console.warn(
      `${TAG} ⚠ [${w.code}] ${w.topic ?? '-'}${w.itemId ? `/${w.itemId}` : ''}: ${w.message}`,
    );
  }

  await ensureDir(OUT_TRANSLATIONS_DIR);

  // 清理上一轮残留（源里删掉的话题，产物必须同步消失）
  const keep = new Set(files.map((f) => `${f.topic}.json`));
  for (const file of fs.readdirSync(OUT_TRANSLATIONS_DIR)) {
    if (file.endsWith('.json') && file !== 'index.json' && !keep.has(file)) {
      fs.rmSync(path.join(OUT_TRANSLATIONS_DIR, file));
      console.log(`${TAG} 移除残留产物 ${file}`);
    }
  }

  // ★ 目录顺序 = TRANSLATION_TOPIC_KEYS（UI 展示顺序），不是文件名字典序
  const byTopic = new Map(files.map((f) => [f.topic, f]));
  const ordered = TRANSLATION_TOPIC_KEYS.map((key) => byTopic.get(key)).filter(
    (f): f is NonNullable<typeof f> => f !== undefined,
  );
  for (const key of TRANSLATION_TOPIC_KEYS) {
    if (!byTopic.has(key)) console.warn(`${TAG} ⚠ 话题 ${key} 没有语料，未写入目录。`);
  }

  let bytes = 0;
  let totalItems = 0;
  const topics: TranslationsIndexFile['topics'] = [];

  for (const file of ordered) {
    // items 顺序保持源文件中的顺序 —— 语料是按难度/教学顺序人工编排的，重排会破坏它
    const payload = {
      topic: file.topic,
      label: TRANSLATION_TOPIC_LABEL[file.topic],
      items: file.items,
    };
    const { bytes: b } = await writeJson(
      path.join(OUT_TRANSLATIONS_DIR, `${file.topic}.json`),
      payload,
    );
    bytes += b;
    totalItems += file.items.length;
    topics.push({ key: file.topic, label: TRANSLATION_TOPIC_LABEL[file.topic], count: file.items.length });
    console.log(
      `${TAG} ${file.topic}（${TRANSLATION_TOPIC_LABEL[file.topic]}）${file.items.length} 句 → ${formatBytes(b)}`,
    );
  }

  const index: TranslationsIndexArtifact = {
    version: '1',
    generatedFrom: 'authored',
    topics,
  };
  const { bytes: ib } = await writeJson(path.join(OUT_TRANSLATIONS_DIR, 'index.json'), index);
  bytes += ib;

  console.log(
    `${TAG} 已产出 ${ordered.length} 个话题 / ${totalItems} 句 + index.json，合计 ${formatBytes(bytes)}`,
  );
}

main().catch((error: unknown) => {
  console.error(`${TAG} 失败：`, error instanceof Error ? error.message : error);
  process.exit(1);
});
