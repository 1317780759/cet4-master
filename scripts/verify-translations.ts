/**
 * scripts/verify-translations.ts —— 翻译训练语料构建期门禁。
 *
 * ★ 与 build-translations.ts 的关系：**门禁前置**。
 *   有 error 级问题就一条产物都不写（与 build-papers.ts:66-75 同纪律）——
 *   "带病产物"比"没有产物"危害大得多：UI 会照常加载并给出错误的评分反馈。
 *
 * ★ 为什么规则 h（head 必须能在 reference 里找到）是 error 而不是 warn：
 *   得分点是**评分器的输入**。`head` 若在参考译文里根本不存在，
 *   说明标注写错了（或抄错了句子），用户照着参考译文背也永远拿不到这个分点。
 *   这类错误静默降级 = 用户被无辜扣分，所以必须拦在构建期。
 *
 * 运行：pnpm tsx scripts/verify-translations.ts [目录...]
 * 退出码：有 error 级问题时 1，否则 0。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TranslationItem, TranslationTopicKey } from '../src/domain/translation/types';
import { TRANSLATION_TOPIC_LABEL, isTranslationTopicKey } from '../src/domain/translation/topics';

const TAG = '[verify-translations]';

/** 校验问题（空数组 = 通过） */
export interface TranslationIssue {
  level: 'error' | 'warn';
  code: string;
  topic?: string;
  itemId?: string;
  message: string;
}

/** 一个话题文件的内存形态（topic 已收敛为合法 key） */
export interface TranslationTopicFile {
  topic: TranslationTopicKey;
  label: string;
  items: TranslationItem[];
}

/**
 * `readTranslationTopicFiles` 内部实际返回的扩展形态：多带一个源文件名。
 *
 * ★ 为什么需要它：规则 a 要求「文件名 == meta.topic 且是合法 key」，
 *   而 `TranslationTopicFile`（对外契约）里没有文件名这个字段 —— 一旦丢了，
 *   门禁就只能用 `topic` 反推，遇到非法文件名时报错信息会指错地方。
 *   保留在**非契约**的扩展字段里，既不污染契约，也能给出可定位的报错。
 */
interface LoadedTranslationTopicFile extends TranslationTopicFile {
  sourceName: string;
}

/** 语料源文件的原始 JSON 形态 */
interface RawTopicFile {
  meta?: { topic?: string; author?: string; license?: string; note?: string };
  items?: TranslationItem[];
}

/** 目录里的非语料文件（跳过，否则会被当成"空话题"误报） */
const NON_TOPIC_FILES = new Set(['index.json', 'manifest.json']);

/** id 形态：`t_` + 小写字母/数字/下划线 */
const ID_RE = /^t_[a-z0-9_]+$/;
/** 参考译文至少含一个 ASCII 字母（否则不可能是英文译文） */
const ASCII_LETTER_RE = /[A-Za-z]/;
/** 分词：只保留小写字母、数字、撇号（撇号用于 people's / don't 这类词形） */
const TOKEN_RE = /[a-z0-9']+/g;

/** 去掉**首尾**撇号（`students'` → `students`），词内撇号保留 */
function stripEdgeApostrophes(word: string): string {
  return word.replace(/^'+/, '').replace(/'+$/, '');
}

/** zh 长度区间（上限宽松，防的是"整段文章误填进单句"这类事故） */
const ZH_MIN = 5;
const ZH_MAX = 200;
/** keyPoints 数量区间（§5.10.3 标注规范） */
const KP_MIN = 3;
const KP_MAX = 6;
/** 同近义词上限 */
const SYN_MAX = 3;
/** 单话题句数下限（warn） */
const TOPIC_ITEMS_MIN = 15;
/** 总句数合理区间（warn） */
const TOTAL_MIN = 200;
const TOTAL_MAX = 400;

/**
 * ★ 规则 h 的「大面积命中」阈值。
 *   超过这个条数说明**可能是规则太严**（而非语料零星写错），
 *   此时应停下来由人判断，不得自行放宽规则、也不得改语料掩盖。
 */
export const HEAD_MISS_ALERT_THRESHOLD = 10;

/** 默认语料目录 */
export const DEFAULT_TRANSLATION_DIR: string = path.join(
  process.cwd(),
  'scripts',
  'data',
  'authored',
  'translation',
);

/** 取源文件名；非 `readTranslationTopicFiles` 产出的对象回退为 topic 本身 */
function sourceNameOf(file: TranslationTopicFile): string {
  const loaded = file as Partial<LoadedTranslationTopicFile>;
  return typeof loaded.sourceName === 'string' ? loaded.sourceName : file.topic;
}

/**
 * 小写分词（结果可直接做连续子序列比对）。
 *
 * ★ 为什么要额外去掉首尾撇号：**与运行时评分器同口径**。
 *   `src/domain/translation/normalize.ts` 的 `stripEdgeApostrophes` + `normalizeToken`
 *   把 `applicants'` 归一成候选键 `{applicants', applicants}` —— 也就是说，
 *   参考译文里的 `applicants'` 在评分器眼里**就是** `applicants`。
 *   若门禁用一套更粗的分词，就会把「评分器明明判得中」的得分点误报成错误。
 *   门禁必须与被它守护的评分器同口径，而不是更严。
 */
export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(TOKEN_RE) ?? [];
  return raw.map(stripEdgeApostrophes).filter((token) => token.length > 0);
}

/** `needle` 是否为 `haystack` 的**连续**子序列（保持词序且中间不插词） */
export function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  const limit = haystack.length - needle.length;
  for (let start = 0; start <= limit; start += 1) {
    let matched = true;
    for (let i = 0; i < needle.length; i += 1) {
      if (haystack[start + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * 读取目录下的全部话题语料文件。
 *
 * ★ 文件名与 `meta.topic` **都**不是合法 topic key 时抛错（而不是记 issue）：
 *   这种文件连"属于哪个话题"都无法确定，放进结果里只能得到一个指错位置的报错。
 */
export function readTranslationTopicFiles(dir: string): TranslationTopicFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_') && !NON_TOPIC_FILES.has(f))
    .sort()
    .map((f) => parseTopicFile(dir, f));
}

function parseTopicFile(dir: string, file: string): LoadedTranslationTopicFile {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as RawTopicFile;
  const sourceName = file.replace(/\.json$/, '');
  const metaTopic = typeof raw?.meta?.topic === 'string' ? raw.meta.topic : '';
  const items = Array.isArray(raw?.items) ? raw.items : [];

  // 文件名优先：它是"这份语料属于哪个话题"的人工约定；meta.topic 只作兜底
  const topic: TranslationTopicKey | null = isTranslationTopicKey(sourceName)
    ? sourceName
    : isTranslationTopicKey(metaTopic)
      ? metaTopic
      : null;
  if (topic === null) {
    throw new Error(
      `${TAG} ${file}：文件名 "${sourceName}" 与 meta.topic "${metaTopic}" 都不是合法的 TranslationTopicKey，` +
        `无法确定话题归属。`,
    );
  }

  return { topic, label: TRANSLATION_TOPIC_LABEL[topic], items, sourceName };
}

/** 规则 a：文件名必须等于 meta.topic，且本身是合法 topic key */
function checkSourceName(file: TranslationTopicFile, issues: TranslationIssue[]): void {
  const sourceName = sourceNameOf(file);
  if (!isTranslationTopicKey(sourceName)) {
    issues.push({
      level: 'error',
      code: 'TOPIC_KEY_INVALID',
      topic: file.topic,
      message: `文件名 "${sourceName}" 不是合法的 TranslationTopicKey（合法值取自 src/domain/translation/topics.ts）`,
    });
    return;
  }
  if (sourceName !== file.topic) {
    issues.push({
      level: 'error',
      code: 'TOPIC_NAME_MISMATCH',
      topic: file.topic,
      message: `文件名 "${sourceName}" 与 meta.topic "${file.topic}" 不一致（两者必须相等）`,
    });
  }
}

/** 规则 g + h：得分点条目与 head↔reference 的一致性 */
function checkKeyPoints(item: TranslationItem, issues: TranslationIssue[]): void {
  const kps = item.keyPoints;
  if (!Array.isArray(kps)) {
    issues.push({
      level: 'error',
      code: 'KP_NOT_ARRAY',
      topic: item.topic,
      itemId: item.id,
      message: 'keyPoints 不是数组',
    });
    return;
  }

  if (kps.length < KP_MIN || kps.length > KP_MAX) {
    issues.push({
      level: 'error',
      code: 'KP_COUNT',
      topic: item.topic,
      itemId: item.id,
      message: `keyPoints 共 ${kps.length} 条，要求 ${KP_MIN}–${KP_MAX} 条`,
    });
    // ★ 不 return：数量不对只是其中一类问题，逐条的问题也要一次性报全
  }

  const seen = new Set<string>();
  let hasCore = false;
  const refTokens = tokenize(typeof item.reference === 'string' ? item.reference : '');

  for (const [index, kp] of kps.entries()) {
    const at = `#${index + 1}`;
    if (kp === null || typeof kp !== 'object') {
      issues.push({
        level: 'error',
        code: 'KP_INVALID',
        topic: item.topic,
        itemId: item.id,
        message: `keyPoints${at} 不是对象`,
      });
      continue;
    }

    const kpId = typeof kp.id === 'string' ? kp.id : '';
    if (kpId === '') {
      issues.push({
        level: 'error',
        code: 'KP_NO_ID',
        topic: item.topic,
        itemId: item.id,
        message: `keyPoints${at} 缺少 id`,
      });
    } else if (seen.has(kpId)) {
      issues.push({
        level: 'error',
        code: 'KP_DUP_ID',
        topic: item.topic,
        itemId: item.id,
        message: `keyPoints${at} 的 id "${kpId}" 在同一句内重复`,
      });
    } else {
      seen.add(kpId);
    }

    const head = typeof kp.head === 'string' ? kp.head.trim() : '';
    if (head === '') {
      issues.push({
        level: 'error',
        code: 'KP_NO_HEAD',
        topic: item.topic,
        itemId: item.id,
        message: `keyPoints${at} 缺少 head`,
      });
    } else if (!containsTokenSequence(refTokens, tokenize(head))) {
      issues.push({
        level: 'error',
        code: 'KP_HEAD_NOT_IN_REF',
        topic: item.topic,
        itemId: item.id,
        message: `keyPoints${at} 的 head "${head}" 在 reference 里找不到（得分点应来自参考译文）`,
      });
    }

    if (kp.weight !== undefined && kp.weight !== 1 && kp.weight !== 2) {
      issues.push({
        level: 'error',
        code: 'KP_BAD_WEIGHT',
        topic: item.topic,
        itemId: item.id,
        message: `keyPoints${at} 的 weight=${String(kp.weight)} 非法，只允许 1 或 2`,
      });
    }
    if (kp.weight === 2) hasCore = true;

    if (kp.synonyms !== undefined) {
      if (!Array.isArray(kp.synonyms)) {
        issues.push({
          level: 'error',
          code: 'KP_BAD_SYNONYMS',
          topic: item.topic,
          itemId: item.id,
          message: `keyPoints${at} 的 synonyms 不是数组`,
        });
      } else if (kp.synonyms.length > SYN_MAX) {
        issues.push({
          level: 'error',
          code: 'KP_TOO_MANY_SYNONYMS',
          topic: item.topic,
          itemId: item.id,
          message: `keyPoints${at} 的 synonyms 共 ${kp.synonyms.length} 条，上限 ${SYN_MAX}`,
        });
      }
    }
  }

  if (!hasCore) {
    issues.push({
      level: 'warn',
      code: 'NO_CORE_KP',
      topic: item.topic,
      itemId: item.id,
      message: '没有任何 weight:2 的核心搭配/句型（全部得分点权重相同，评分区分度会偏低）',
    });
  }
}

/** 规则 b / c / d / e / f / i + warn（缺 hints） */
function checkItem(
  item: TranslationItem,
  topic: TranslationTopicKey,
  issues: TranslationIssue[],
  globalIds: Map<string, string>,
): void {
  // —— b：id 非空、全局唯一、形态合规 ——
  const id = typeof item?.id === 'string' ? item.id : '';
  const itemId = id === '' ? '(missing)' : id;
  if (id === '') {
    issues.push({ level: 'error', code: 'NO_ID', topic, itemId, message: '句子缺少 id' });
  } else if (!ID_RE.test(id)) {
    issues.push({
      level: 'error',
      code: 'BAD_ID',
      topic,
      itemId,
      message: `id "${id}" 不匹配 ${String(ID_RE)}`,
    });
  }
  if (id !== '') {
    const prev = globalIds.get(id);
    if (prev !== undefined) {
      issues.push({
        level: 'error',
        code: 'DUP_ID',
        topic,
        itemId,
        message: `id "${id}" 与话题 ${prev} 中的句子重复（id 必须全局唯一）`,
      });
    } else {
      globalIds.set(id, topic);
    }
  }

  // —— c：item.topic 必须等于所在文件的 topic ——
  if (item?.topic !== topic) {
    issues.push({
      level: 'error',
      code: 'TOPIC_MISMATCH',
      topic,
      itemId,
      message: `item.topic="${String(item?.topic)}" 与所在话题 "${topic}" 不一致`,
    });
  }

  // —— d：difficulty ∈ {1,2,3} ——
  if (item?.difficulty !== 1 && item?.difficulty !== 2 && item?.difficulty !== 3) {
    issues.push({
      level: 'error',
      code: 'BAD_DIFFICULTY',
      topic,
      itemId,
      message: `difficulty=${String(item?.difficulty)} 非法，只允许 1 / 2 / 3`,
    });
  }

  // —— e：zh 非空且长度 5..200 ——
  const zh = typeof item?.zh === 'string' ? item.zh.trim() : '';
  if (zh === '') {
    issues.push({ level: 'error', code: 'EMPTY_ZH', topic, itemId, message: 'zh 为空' });
  } else if (zh.length < ZH_MIN || zh.length > ZH_MAX) {
    issues.push({
      level: 'error',
      code: 'ZH_LENGTH',
      topic,
      itemId,
      message: `zh 长度 ${zh.length}，要求 ${ZH_MIN}–${ZH_MAX}`,
    });
  }

  // —— f：reference 非空且含 ASCII 字母 ——
  const reference = typeof item?.reference === 'string' ? item.reference : '';
  if (reference.trim() === '') {
    issues.push({ level: 'error', code: 'EMPTY_REF', topic, itemId, message: 'reference 为空' });
  } else if (!ASCII_LETTER_RE.test(reference)) {
    issues.push({
      level: 'error',
      code: 'REF_NO_ASCII',
      topic,
      itemId,
      message: 'reference 不含任何 ASCII 字母（不是英文译文）',
    });
  }

  // —— g / h：得分点 ——
  checkKeyPoints(item, issues);

  // —— i：source === 'authored' ——
  if (item?.source !== 'authored') {
    issues.push({
      level: 'error',
      code: 'BAD_SOURCE',
      topic,
      itemId,
      message: `source="${String(item?.source)}" 非法，本期语料必须全部为 'authored'`,
    });
  }

  // —— warn：缺 hints（运行时会由 keyPoints 兜底生成 1 级提示，仅提示体验降级）——
  if (!Array.isArray(item?.hints) || item.hints.length === 0) {
    issues.push({
      level: 'warn',
      code: 'NO_HINTS',
      topic,
      itemId,
      message: '缺少 hints（运行时将只用 keyPoints 兜底生成 1 级提示，三级提示不可用）',
    });
  }
}

/** 校验一批话题语料，返回问题清单（空数组 = 通过） */
export function verifyTranslations(files: TranslationTopicFile[]): TranslationIssue[] {
  const issues: TranslationIssue[] = [];
  const globalIds = new Map<string, string>();
  let total = 0;

  for (const file of files) {
    checkSourceName(file, issues);

    const items = Array.isArray(file.items) ? file.items : [];
    if (items.length === 0) {
      issues.push({
        level: 'error',
        code: 'NO_ITEMS',
        topic: file.topic,
        message: `话题 ${file.topic} 没有任何句子`,
      });
      continue;
    }
    if (items.length < TOPIC_ITEMS_MIN) {
      issues.push({
        level: 'warn',
        code: 'FEW_ITEMS',
        topic: file.topic,
        message: `话题 ${file.topic} 只有 ${items.length} 句（少于 ${TOPIC_ITEMS_MIN} 句）`,
      });
    }

    for (const item of items) {
      checkItem(item, file.topic, issues, globalIds);
    }
    total += items.length;
  }

  if (total < TOTAL_MIN || total > TOTAL_MAX) {
    issues.push({
      level: 'warn',
      code: 'TOTAL_OUT_OF_RANGE',
      message: `总句数 ${total} 落在合理区间 ${TOTAL_MIN}–${TOTAL_MAX} 之外`,
    });
  }

  return issues;
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

/** CLI：读目录 → 校验 → 打印（有 error 时退出码 1） */
export function main(): void {
  const dirs = process.argv.slice(2);
  const list = dirs.length > 0 ? dirs : [DEFAULT_TRANSLATION_DIR];
  const files = list.flatMap((d) => readTranslationTopicFiles(d));

  if (files.length === 0) {
    console.log(`${TAG} 目录 ${list.join('、')} 下没有语料，跳过。`);
    return;
  }

  const issues = verifyTranslations(files);
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const total = files.reduce((n, f) => n + (Array.isArray(f.items) ? f.items.length : 0), 0);

  console.log(`${TAG} 校验 ${files.length} 个话题 / ${total} 句：`);
  for (const f of files) {
    console.log(`  · ${f.topic}（${f.label}）${Array.isArray(f.items) ? f.items.length : 0} 句`);
  }

  for (const w of warns) {
    console.warn(`  ⚠ [${w.code}] ${w.topic ?? '-'}${w.itemId ? `/${w.itemId}` : ''}: ${w.message}`);
  }
  for (const e of errors) {
    console.error(`  ✗ [${e.code}] ${e.topic ?? '-'}${e.itemId ? `/${e.itemId}` : ''}: ${e.message}`);
  }

  // ★ 规则 h 大面积命中 → 明确提示"停下来找人判断"，不得自行放宽
  const headMiss = errors.filter((e) => e.code === 'KP_HEAD_NOT_IN_REF');
  if (headMiss.length > HEAD_MISS_ALERT_THRESHOLD) {
    console.error(
      `${TAG} ⚠ 规则 h（head 必须在 reference 中）命中 ${headMiss.length} 条，` +
        `超过阈值 ${HEAD_MISS_ALERT_THRESHOLD} —— 这更可能是**规则过严**而非语料零星写错，` +
        `请先人工复核，不要放宽规则、也不要改语料掩盖。`,
    );
  }

  if (errors.length > 0) {
    console.error(`${TAG} ✗ ${errors.length} 个 error，${warns.length} 个 warn。`);
    process.exit(1);
  }
  console.log(`${TAG} ✓ 通过（0 个 error，${warns.length} 个 warn）。`);
}

// ★ 只在被直接执行时跑 CLI：build-translations.ts 会 import 本文件的纯函数
if (isDirectRun()) main();
