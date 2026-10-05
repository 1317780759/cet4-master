/**
 * AI 批改结果的三级容错解析 + schema 校验（纯函数，零 IO —— 铁律 A1）。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.14.6（流式渲染 C · 解析容错 / D · 校验）。
 *
 * ★ 铁律：绝不允许把未解析的中间态当评分展示 —— 那等于"把模型胡说的数字当成成绩"。
 *   因此本模块要么返回**校验通过**的 `LlmReview`，要么返回 `null`（→ 回退离线评分），
 *   **不存在"勉强用一下"的第三条路**。
 */

/** 纠错类型白名单（七种，与 system prompt 第 3 条逐字对应） */
export type CorrectionType =
  | 'grammar'
  | 'spelling'
  | 'word-choice'
  | 'missing-info'
  | 'word-order'
  | 'punctuation'
  | 'capitalization';

/** 单条逐句纠错 */
export interface LlmCorrection {
  /** 用户原句（原文照抄，不做 trim，便于 UI 高亮定位） */
  original: string;
  /** 修改建议 */
  suggested: string;
  type: CorrectionType;
  /** 一句话中文说明 */
  note: string;
}

/** 参考档位 0–4（★ 仅供练习参考，绝不称为"四级官方评分"） */
export type LlmBand = 0 | 1 | 2 | 3 | 4;

/** 解析后的 AI 批改结果 */
export interface LlmReview {
  /** 0..15 的整数 */
  score: number;
  band: LlmBand;
  /** 最多 `MAX_CORRECTIONS` 条 */
  corrections: LlmCorrection[];
  /** 亮点；缺失时为空数组 */
  highlights: string[];
  /** 总体改进建议；缺失时为空串 */
  advice: string;
}

/** 纠错类型白名单（运行时校验用） */
export const CORRECTION_TYPES: readonly CorrectionType[] = [
  'grammar',
  'spelling',
  'word-choice',
  'missing-info',
  'word-order',
  'punctuation',
  'capitalization',
];

/** 分数下界 / 上界（四级翻译满分 15） */
export const SCORE_MIN = 0;
export const SCORE_MAX = 15;

/** 纠错最多保留条数（与 system prompt 第 4 条一致） */
export const MAX_CORRECTIONS = 5;

/** 纯对象判定（排除 null 与数组） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 取字符串；非字符串返回 null（不做强制转换，避免把对象/数字变成 "[object Object]"） */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** 取有限数字；NaN / Infinity / 非数字返回 null */
function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 纠错类型白名单判定 */
function isCorrectionType(value: unknown): value is CorrectionType {
  return typeof value === 'string' && (CORRECTION_TYPES as readonly string[]).includes(value);
}

/** 合法档位判定（0..4 的整数） */
function isBand(value: unknown): value is LlmBand {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
}

/**
 * 由分数推导档位（band 缺失时使用）。
 *
 * 与 system prompt 的六档表对应：≥14 → 4，≥11 → 3，≥8 → 2，≥5 → 1，否则 0。
 */
export function bandFromScore(score: number): LlmBand {
  if (score >= 14) return 4;
  if (score >= 11) return 3;
  if (score >= 8) return 2;
  if (score >= 5) return 1;
  return 0;
}

/** 剥掉 ```json … ``` 围栏（取第一个围栏块的内容） */
function stripFence(text: string): string | null {
  const match = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  if (!match || match[1] === undefined) return null;
  const inner = match[1].trim();
  return inner.length > 0 ? inner : null;
}

/** 截取第一个 `{` 到最后一个 `}`（应对前后啰嗦文本） */
function sliceBraces(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/** 安全 JSON 解析：失败返回 null（不抛异常，交给三级容错继续尝试） */
function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * 三级容错取出 JSON：
 * ① 裸 JSON 直接解析 → ② 剥掉 ```json 围栏 → ③ 截取首个 `{` 到最后一个 `}`。
 *
 * 三级全败返回 `null`。
 */
function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // ① 裸 JSON
  const level1 = tryParse(trimmed);
  if (level1 !== null) return level1;

  // ② 带围栏
  const fenced = stripFence(trimmed);
  if (fenced !== null) {
    const level2 = tryParse(fenced);
    if (level2 !== null) return level2;
  }

  // ③ 前后啰嗦文本
  const sliced = sliceBraces(trimmed);
  if (sliced !== null) {
    const level3 = tryParse(sliced);
    if (level3 !== null) return level3;
  }

  return null;
}

/** 单条纠错 → `LlmCorrection`；字段不全或 type 不在白名单内 → 丢弃该条 */
function toCorrection(raw: unknown): LlmCorrection | null {
  if (!isRecord(raw)) return null;
  const original = asString(raw.original);
  const suggested = asString(raw.suggested);
  const note = asString(raw.note);
  // ★ type 不在七种白名单内 → 丢弃该条（而不是让整份结果报废）
  if (!isCorrectionType(raw.type)) return null;
  // original / suggested 缺失即"字段不全"，无法展示 → 同样丢弃该条
  if (original === null || suggested === null) return null;
  return { original, suggested, type: raw.type, note: note ?? '' };
}

/** 字符串数组清洗：非字符串元素一律剔除；缺失或非数组 → 空数组 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text = asString(item);
    if (text !== null) result.push(text);
  }
  return result;
}

/**
 * 取 advice 字段。
 *
 * ★ 容错：文档 schema 示例里 `advice` 是数组，而 `LlmReview.advice` 是字符串，
 *   因此数组形态按换行拼接，字符串形态原样保留，其余形态给空串。
 */
function toAdvice(value: unknown): string {
  const text = asString(value);
  if (text !== null) return text;
  if (Array.isArray(value)) return toStringArray(value).join('\n');
  return '';
}

/**
 * 解析 AI 返回的文本为结构化批改结果。
 *
 * - 三级容错：裸 JSON / 剥围栏 / 截取花括号；三级全败 → `null`
 * - `score` 必须是 0..15 的数字（越界如 99、或非数字 → `null`）
 * - `band` 必须是 0..4 的整数（缺失则由 score 推导；越界或非法 → `null`）
 * - `corrections` 最多 5 条；`type` 不在白名单内的条目**丢弃该条**而不是整份报废
 * - `highlights` / `advice` 缺失 → 空数组 / 空串
 *
 * @param text AI 流式返回的累积全文
 * @returns 校验通过的批改结果；无法解析或校验不通过时为 `null`（调用方回退离线评分）
 */
export function parseLlmReview(text: string): LlmReview | null {
  const json = extractJson(text);
  if (!isRecord(json)) return null;

  // ★ score 越界 / 非数字 → 整份作废（不接受"模型随便给的分"）
  const rawScore = asFiniteNumber(json.score);
  if (rawScore === null) return null;
  if (rawScore < SCORE_MIN || rawScore > SCORE_MAX) return null;
  const score = Math.round(rawScore);

  // band：缺失则由 score 推导；给了但非法 → 同样作废
  const rawBand = json.band;
  let band: LlmBand;
  if (rawBand === undefined || rawBand === null) {
    band = bandFromScore(score);
  } else if (isBand(rawBand)) {
    band = rawBand;
  } else {
    return null;
  }

  const rawCorrections = json.corrections;
  const corrections: LlmCorrection[] = [];
  if (Array.isArray(rawCorrections)) {
    for (const item of rawCorrections) {
      if (corrections.length >= MAX_CORRECTIONS) break;
      const correction = toCorrection(item);
      if (correction !== null) corrections.push(correction);
    }
  }

  return {
    score,
    band,
    corrections,
    highlights: toStringArray(json.highlights),
    advice: toAdvice(json.advice),
  };
}
