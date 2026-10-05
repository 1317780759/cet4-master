/**
 * 中文段落拆句 —— 纯函数，**构建期与运行期共用同一实现**。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.6。
 *
 * ★ 关键设计：`scripts/build-translation.ts` **直接 import** 本文件
 *   （与 `build-wordbank.ts` 复用 `src/domain/word/tier.ts::tierOf` 同一纪律）。
 *   于是：构建期把段落拆好写进 JSON，运行期零计算、结果可复现、单一真源。
 */

/** 拆出的一个句段。 `start/end` 是**原段落**的字符区间（`[start, end)`），供 UI 做「整段原文 + 当前句高亮」 */
export interface Segment {
  /** 在结果数组中的序号，从 0 开始 */
  index: number;
  /** 句段文本（含跟随的句末标点） */
  text: string;
  /** 原段落起始下标（含） */
  start: number;
  /** 原段落结束下标（不含） */
  end: number;
}

export interface SegmentOptions {
  /** 单句最大汉字数，超过则在「，/、」处二次切分；默认 60；`0` = 不二切 */
  maxLen?: number;
  /** 作者指定的切点（字符下标数组），优先级最高 —— JSON 里的人工覆盖通道 `"cuts": [23, 47]` */
  cuts?: readonly number[];
}

/** 默认单句最大字数 */
export const DEFAULT_MAX_LEN = 60;

/** 二切后每片的最小字数 —— 低于此值不切，避免无意义碎片 */
export const MIN_PART_LEN = 12;

/** 句末标点（含全角） */
const SENTENCE_END_PATTERN = /[。！？；!?;]/;

/** 紧跟句末标点时应并入前句的右引号 / 右括号 */
const CLOSING_CHARS = new Set(Array.from('”)）』】》」』\'）'));

/** 二切允许的软切点 */
const SOFT_BREAK_CHARS = new Set(Array.from('，、'));

/** 区间类型 `[start, end)` */
type Range = readonly [number, number];

/** 字数统计：不计空白（中文段落内部通常无空格，此处仅做稳健处理） */
function charCount(text: string, start: number, end: number): number {
  let count = 0;
  for (let i = start; i < end; i += 1) {
    if (!/\s/.test(text[i] as string)) count += 1;
  }
  return count;
}

/**
 * 长句二次切分（只在「，/、」处切，且切后每片 ≥ `MIN_PART_LEN` 字）。
 *
 * 切点选择：在所有合法软切点中取**左右两片字数差最小**的那个（均衡切分），
 * 然后对左右两片递归继续切，直到不再超长。
 */
function splitLong(text: string, start: number, end: number, maxLen: number): Range[] {
  const total = charCount(text, start, end);
  if (maxLen <= 0 || total <= maxLen) return [[start, end]];

  let bestAt = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = start; i < end; i += 1) {
    if (!SOFT_BREAK_CHARS.has(text[i] as string)) continue;
    const left = charCount(text, start, i + 1);
    const right = charCount(text, i + 1, end);
    if (left < MIN_PART_LEN || right < MIN_PART_LEN) continue;
    const diff = Math.abs(left - right);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestAt = i;
    }
  }

  if (bestAt < 0) return [[start, end]];

  const leftRange: Range = [start, bestAt + 1];
  const rightRange: Range = [bestAt + 1, end];
  return [...splitLong(text, leftRange[0], leftRange[1], maxLen), ...splitLong(text, rightRange[0], rightRange[1], maxLen)];
}

/**
 * 中文段落拆句。
 *
 * 规则（§5.6）：
 *   1. 按 `[。！？；!?;]`（含全角）切分，标点**跟随前句**保留在 `text` 里；
 *   2. 右引号 / 右括号紧跟标点时并入前句；
 *   3. `cuts` 优先：给定下标处**无条件**切开；
 *   4. `maxLen` 二切：只在「，/、」处切，且切后长度 ≥ 12 字；
 *   5. 返回的 `start/end` 是原段落字符区间。
 *
 * @example
 * segmentChinese('春节是中国最重要的传统节日。人们会回家团圆，一起吃年夜饭。')
 * // → [{index:0,text:'春节是中国最重要的传统节日。',start:0,end:15}, {index:1,text:'人们会回家团圆，一起吃年夜饭。',start:15,end:29}]
 */
export function segmentChinese(text: string, options: SegmentOptions = {}): Segment[] {
  if (typeof text !== 'string' || text.length === 0) return [];

  const maxLen = typeof options.maxLen === 'number' ? options.maxLen : DEFAULT_MAX_LEN;
  const cuts = options.cuts ?? [];

  // 1~3) 收集「从此下标开始新句」的切点
  const breaks = new Set<number>();
  for (const cut of cuts) {
    if (Number.isInteger(cut) && cut > 0 && cut < text.length) breaks.add(cut);
  }
  for (let i = 0; i < text.length; i += 1) {
    if (!SENTENCE_END_PATTERN.test(text[i] as string)) continue;
    let j = i + 1;
    while (j < text.length && CLOSING_CHARS.has(text[j] as string)) j += 1;
    if (j < text.length) breaks.add(j);
  }

  const sorted = [...breaks].sort((a, b) => a - b);
  const rawRanges: Range[] = [];
  let cursor = 0;
  for (const at of sorted) {
    if (at > cursor) {
      rawRanges.push([cursor, at]);
      cursor = at;
    }
  }
  rawRanges.push([cursor, text.length]);

  // 4) 长句二切
  const ranges: Range[] = [];
  for (const [start, end] of rawRanges) {
    for (const range of splitLong(text, start, end, maxLen)) ranges.push(range);
  }

  // 5) 去空白 + 连续编号
  const segments: Segment[] = [];
  for (const [start, end] of ranges) {
    let from = start;
    let to = end;
    while (from < to && /\s/.test(text[from] as string)) from += 1;
    while (to > from && /\s/.test(text[to - 1] as string)) to -= 1;
    if (to <= from) continue;
    segments.push({ index: segments.length, text: text.slice(from, to), start: from, end: to });
  }
  return segments;
}
