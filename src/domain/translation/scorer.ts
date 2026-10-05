/**
 * 离线关键词评分器 —— 纯函数（铁律 A1：零 React、零 IO、零日期、零随机）。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.4（抽象）、§5.5.2（匹配算法）。
 *
 * ★ 纯函数契约：时间 / 随机源**全部由 `deps` 注入**，函数体内
 *   不得出现 `Date.now()` / `Math.random()` 裸调用。离线评分是确定性计算，
 *   当前不消费这两个值，但签名先行固化，二期换成 LLM 实现时无需再改调用方。
 */

import { candidateSetOf, tokenizeEn } from './normalize';
import type { Token } from './normalize';
import type { Band, KeyPoint, KeyPointHit, Score, ScoreRequest, ScoreResult, TranslationScorer } from './types';

/**
 * 纯函数依赖注入口。
 *
 * ★ 离线评分不消费 `now` / `random`，但两者必须存在：
 *   一旦有人往 `scoreOffline` 里写 `Date.now()`，调用方就能从签名发现「这里不该有副作用」。
 */
export interface ScorerDeps {
  /** 注入的"当前时间"（epoch ms） */
  now: number;
  /** 注入的随机源，返回 `[0, 1)` */
  random: () => number;
}

/** 默认依赖：固定值 + 常量随机源 —— 保证无 deps 调用时仍是纯函数 */
export const DEFAULT_SCORER_DEPS: ScorerDeps = {
  now: 0,
  random: () => 0,
};

/** 关键词权重常量（§5.10.3：核心搭配 2 / 普通实词 1 / 可选词 `optional: true`） */
export const KEYWORD_WEIGHT = {
  /** 未显式指定 `weight` 时的默认权重 */
  default: 1,
  /** 核心搭配 / 句型建议权重 */
  core: 2,
  /**
   * `optional: true` 且**未命中**时，计入分母的折算系数（§5.5.2 step 4）。
   * 命中则按满权重计入分子与分母。
   */
  optionalMissFactor: 0.5,
} as const;

/** 档位规则。`minRatio` 从高到低排列，`ratio >= minRatio` 即命中该档 */
export interface BandRule {
  /** 命中该档的最低 ratio（含） */
  minRatio: number;
  band: Band;
  /** 给 UI 的参考说明（★ 不得称为"官方评分"） */
  label: string;
}

/**
 * 档位映射表 —— ★ 上线后按真人反馈微调阈值**只改这张表**，不动代码结构。
 *
 * ⚠️ 修改本表必须同步更新 `__tests__/golden.test.ts` 的金标准回归集。
 */
export const BAND_TABLE: readonly BandRule[] = [
  { minRatio: 0.95, band: 4, label: '参考 14–15 档' },
  { minRatio: 0.8, band: 3, label: '参考 11–13 档' },
  { minRatio: 0.6, band: 2, label: '参考 8–10 档' },
  { minRatio: 0.4, band: 1, label: '参考 5–7 档' },
  { minRatio: 0, band: 0, label: '参考 1–4 档' },
];

/** 评分器自述标签（UI 展示"离线评分"来源） */
export const OFFLINE_SCORER_LABEL = '离线关键词评分';

/** ratio 保留小数位（避免浮点尾数把 0.95 打成 0.949999… 从而掉档） */
const RATIO_PRECISION = 4;

/** 兜底档位：`BAND_TABLE` 被清空时的返回值 */
const FALLBACK_BAND: Band = 0;

/** 取一个 keyPoint 的权重 */
function weightOf(keyPoint: KeyPoint): number {
  const weight = keyPoint.weight;
  return typeof weight === 'number' && Number.isFinite(weight) ? weight : KEYWORD_WEIGHT.default;
}

/** ratio → 档位 */
export function bandOf(ratio: number): Band {
  for (const rule of BAND_TABLE) {
    if (ratio >= rule.minRatio) return rule.band;
  }
  return FALLBACK_BAND;
}

/** 校验纯函数契约（deps 必须注入合法的时间与随机源） */
function assertPureDeps(deps: ScorerDeps): void {
  if (!Number.isFinite(deps.now) || typeof deps.random !== 'function') {
    throw new TypeError('scoreOffline: deps 必须注入合法的 now(number) 与 random(function)');
  }
}

/** 候选模式：`head` 与 `synonyms` 各自分词后的词序列 */
function patternsOf(keyPoint: KeyPoint): string[][] {
  const sources = [keyPoint.head, ...(keyPoint.synonyms ?? [])];
  const patterns: string[][] = [];
  for (const source of sources) {
    if (typeof source !== 'string' || source.length === 0) continue;
    const words = tokenizeEn(source).map((token) => token.text);
    if (words.length > 0) patterns.push(words);
  }
  return patterns;
}

interface PreparedToken {
  token: Token;
  keys: Set<string>;
}

interface PreparedKeyPoint {
  index: number;
  keyPoint: KeyPoint;
  patterns: string[][];
  /** head 的词数 —— 决定「多词优先」的排序 */
  headLength: number;
  /** 单词得分点的合并候选集（n=1 路径专用） */
  accepted: Set<string>;
}

function prepare(keyPoints: readonly KeyPoint[]): PreparedKeyPoint[] {
  return keyPoints.map((keyPoint, index) => {
    const patterns = patternsOf(keyPoint);
    const accepted = new Set<string>();
    for (const pattern of patterns) {
      if (pattern.length === 1) {
        for (const key of candidateSetOf(pattern[0] as string)) accepted.add(key);
      }
    }
    const headLength = tokenizeEn(keyPoint.head).length;
    return { index, keyPoint, patterns, headLength, accepted };
  });
}

/** 在 tokens 上找一个长度为 n 的连续窗口，逐位比对候选集合；返回首个命中的窗口起点，-1 表示未命中 */
function findPhrase(tokens: PreparedToken[], pattern: readonly string[], consumed: boolean[]): number {
  const size = pattern.length;
  if (size === 0 || tokens.length < size) return -1;
  for (let start = 0; start + size <= tokens.length; start += 1) {
    let ok = true;
    for (let offset = 0; offset < size; offset += 1) {
      const position = start + offset;
      if (consumed[position]) {
        ok = false;
        break;
      }
      const keys = (tokens[position] as PreparedToken).keys;
      let matched = false;
      for (const key of candidateSetOf(pattern[offset] as string)) {
        if (keys.has(key)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        ok = false;
        break;
      }
    }
    if (ok) return start;
  }
  return -1;
}

/** 找一个未被占用的、候选集合与 accepted 有交集的 token；返回下标，-1 表示未命中 */
function findSingle(tokens: PreparedToken[], accepted: Set<string>, consumed: boolean[]): number {
  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed[i]) continue;
    for (const key of (tokens[i] as PreparedToken).keys) {
      if (accepted.has(key)) return i;
    }
  }
  return -1;
}

/**
 * 离线评分主函数 —— **纯函数**。
 *
 * 算法（§5.5.2）：
 *   1. 用户译文分词 + 预计算候选集合；
 *   2. **多词 keyPoint 先于单词 keyPoint**（词数降序，稳定排序）；
 *   3. 多词：滑长度为 n 的窗口逐位比对候选交集；单词：遍历未 consumed 的 token；
 *   4. **consumed 机制**：命中的 token 被标记占用，防止一个 `development`
 *      同时满足 `with the development of` 与 `rapid development` 导致分数虚高；
 *   5. `ratio = Σ(命中 weight) / Σ(全部 weight)`，`optional` 未命中项按 0.5 权重计入分母。
 *
 * @param req 用户译文 + 得分点
 * @param deps 时间 / 随机源注入（纯函数契约）
 */
export function scoreOffline(req: ScoreRequest, deps?: Partial<ScorerDeps>): ScoreResult {
  const env: ScorerDeps = { ...DEFAULT_SCORER_DEPS, ...(deps ?? {}) };
  assertPureDeps(env);

  const text = typeof req?.text === 'string' ? req.text : '';
  const keyPoints: readonly KeyPoint[] = Array.isArray(req?.keyPoints) ? req.keyPoints : [];

  const tokens: PreparedToken[] = tokenizeEn(text).map((token) => ({
    token,
    keys: candidateSetOf(token.text),
  }));
  const consumed = new Array<boolean>(tokens.length).fill(false);

  const prepared = prepare(keyPoints);
  // ★ 多词优先（词数降序）。Array.prototype.sort 是稳定排序，同词数保持标注顺序。
  const order = [...prepared].sort((a, b) => b.headLength - a.headLength);

  const hits = new Map<number, KeyPointHit>();

  for (const entry of order) {
    let hit: KeyPointHit | null = null;
    // 单词路径用的是所有单词模式的**并集**，因此只需尝试一次
    let singleAttempted = false;

    for (const pattern of entry.patterns) {
      if (pattern.length >= 2) {
        const start = findPhrase(tokens, pattern, consumed);
        if (start >= 0) {
          const first = tokens[start] as PreparedToken;
          const last = tokens[start + pattern.length - 1] as PreparedToken;
          const span: [number, number] = [first.token.start, last.token.end];
          for (let i = start; i < start + pattern.length; i += 1) consumed[i] = true;
          hit = {
            id: entry.keyPoint.id,
            head: entry.keyPoint.head,
            zh: entry.keyPoint.zh,
            hit: true,
            span,
            matchedAs: text.slice(span[0], span[1]),
          };
          break;
        }
      } else if (pattern.length === 1 && !singleAttempted) {
        singleAttempted = true;
        const position = findSingle(tokens, entry.accepted, consumed);
        if (position >= 0) {
          const found = tokens[position] as PreparedToken;
          const span: [number, number] = [found.token.start, found.token.end];
          consumed[position] = true;
          hit = {
            id: entry.keyPoint.id,
            head: entry.keyPoint.head,
            zh: entry.keyPoint.zh,
            hit: true,
            span,
            matchedAs: text.slice(span[0], span[1]),
          };
          break;
        }
      }
    }

    hits.set(
      entry.index,
      hit ?? {
        id: entry.keyPoint.id,
        head: entry.keyPoint.head,
        zh: entry.keyPoint.zh,
        hit: false,
        span: null,
      },
    );
  }

  // points 顺序回到 keyPoints 原顺序（UI 直接按下标渲染 ✓/✗）
  const points: KeyPointHit[] = prepared.map(
    (entry) => hits.get(entry.index) as KeyPointHit,
  );

  let earned = 0;
  let denominator = 0;
  let hitCount = 0;
  prepared.forEach((entry, i) => {
    const weight = weightOf(entry.keyPoint);
    if ((points[i] as KeyPointHit).hit) {
      earned += weight;
      denominator += weight;
      hitCount += 1;
    } else {
      denominator += entry.keyPoint.optional === true
        ? weight * KEYWORD_WEIGHT.optionalMissFactor
        : weight;
    }
  });

  const rawRatio = denominator > 0 ? earned / denominator : 0;
  const factor = 10 ** RATIO_PRECISION;
  const ratio = Math.round(rawRatio * factor) / factor;

  return {
    total: keyPoints.length,
    hit: hitCount,
    ratio,
    points,
    band: bandOf(ratio),
    scoredBy: OFFLINE_SCORER_LABEL,
  };
}

/** 把完整评分结果压成落库用的精简快照（错句本 / 统计） */
export function toScore(result: ScoreResult): Score {
  return {
    hit: result.hit,
    total: result.total,
    ratio: result.ratio,
    band: result.band,
    scoredBy: result.scoredBy,
  };
}

/**
 * 离线评分器适配器 —— `TranslationScorer` 的**唯一**一期实现。
 *
 * ★ 异步签名是刻意的：二期换成 LLM 实现（需要流式 / 超时）时，
 *   UI 与 `translationScorerRegistry` **零改动**。
 */
export function createOfflineScorer(deps?: Partial<ScorerDeps>): TranslationScorer {
  return {
    id: 'offline',
    label: OFFLINE_SCORER_LABEL,
    async score(req: ScoreRequest): Promise<ScoreResult> {
      return scoreOffline(req, deps);
    },
  };
}
