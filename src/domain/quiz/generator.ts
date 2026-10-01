import type { Word } from '@/domain/word/types';

/**
 * 四选一测验生成器 —— 纯函数（铁律 A1：零 React / 零 IO / 零 Date）。
 *
 * ★ 设计上刻意做对的三件事（决定了测验是不是"有效测验"）：
 *
 *   1. **干扰项必须像真的**。随机抽词当干扰项会产生"一眼看出答案"的废题
 *      （比如拿 `abandon` 去混 `photosynthesis`）。所以干扰项按
 *      **同 tier 优先 + 词长接近**排序，让选项之间具有可比性。
 *   2. **选项文本去重**。不同词可能给出相同的中文释义（如多个词都释为"放弃"），
 *      若不去重就会出现两个"看起来都对"的选项 —— 那是**错题**，不是难。
 *   3. **确定性**。`seed` 相同必得同一套题：单测可断言，且支持"重做同一套"。
 *      随机源用自实现 mulberry32，**不用 `Math.random()`**（不可复现）。
 */

export type QuizDirection = 'en-to-zh' | 'zh-to-en';

export type OptionKey = 'A' | 'B' | 'C' | 'D';

export interface QuizOption {
  key: OptionKey;
  text: string;
  /** zh-to-en 时是干扰/正确词；en-to-zh 时是释义来源词。用于事后讲评。 */
  wordId: string;
}

export interface QuizQuestion {
  /** 稳定 id（同一 seed + 同一词序下恒定） */
  id: string;
  /** 被考词 */
  wordId: string;
  direction: QuizDirection;
  stem: string;
  options: QuizOption[];
  answerKey: OptionKey;
  /** 干扰项来源词 id（不含被考词） */
  distractorWordIds: string[];
}

export interface GenerateQuizInput {
  /** 被考词池（通常来自今日学习队列 / 已学词 / 错题） */
  words: readonly Word[];
  /** 干扰项池，缺省时复用 words。实践中应传更大的全库，干扰项质量才高 */
  distractorPool?: readonly Word[];
  count?: number;
  direction?: QuizDirection;
  /** 随机种子；相同 seed 产出完全相同的一套题 */
  seed?: number;
  /** 每题选项数，默认 4 */
  optionsPerQuestion?: number;
}

const KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];

/** mulberry32 —— 32 位确定性 PRNG，返回值 ∈ [0,1) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 取用于展示的释义（首义项；无义项的词不参与出题） */
function primarySenseZh(word: Word): string | undefined {
  const zh = word.senses.find((s) => s.zh.trim() !== '')?.zh;
  return zh?.trim();
}

/** 洗牌（Fisher–Yates，用注入的 rand 保证可复现） */
function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** 归一化比较用：去空白 + 小写（中文不受影响，只为英文选项兜底） */
function norm(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * 为单个词挑选干扰项。
 * 排序规则：同 tier 优先 → 词长接近优先 → 用 rand 打破平局（保证每次不同）。
 */
function pickDistractors(
  target: Word,
  pool: readonly Word[],
  needed: number,
  rand: () => number,
): Word[] {
  const targetText = norm(primarySenseZh(target) ?? target.headword);

  const candidates = pool.filter((w) => {
    if (w.id === target.id) return false;
    const text = primarySenseZh(w);
    if (text === undefined) return false;
    // ★ 与正确答案文本相同的选项必须剔除（否则会出现两个"都对"）
    return norm(text) !== targetText && norm(w.headword) !== norm(target.headword);
  });

  if (candidates.length < needed) return [];

  const scored = candidates.map((w) => ({
    word: w,
    // 越小越像：同 tier = 0，否则 1；再叠加词长差 / 10
    score:
      (w.tier === target.tier ? 0 : 1) +
      Math.abs(w.headword.length - target.headword.length) / 10 +
      rand() * 0.5,
  }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, needed).map((s) => s.word);
}

/**
 * 生成四选一题。
 *
 * ⚠️ 干扰项不足的词会被**跳过**而不是"少几个选项" ——
 *    三选一 / 二选一会显著抬高蒙对率，使测验结果失去意义。
 */
export function generateQuiz(input: GenerateQuizInput): QuizQuestion[] {
  const {
    words,
    distractorPool,
    count = 10,
    direction = 'en-to-zh',
    seed = 1,
    optionsPerQuestion = 4,
  } = input;

  const rand = mulberry32(seed);
  const pool = distractorPool ?? words;
  const questions: QuizQuestion[] = [];
  const used = new Set<string>();

  for (const target of words) {
    if (questions.length >= count) break;
    if (used.has(target.id)) continue;

    const targetZh = primarySenseZh(target);
    if (targetZh === undefined) continue; // 无释义 → 出不了题

    const distractors = pickDistractors(target, pool, optionsPerQuestion - 1, rand);
    if (distractors.length < optionsPerQuestion - 1) continue; // 干扰项不足 → 跳过整题

    used.add(target.id);
    for (const d of distractors) used.add(d.id);

    const correctText = direction === 'en-to-zh' ? targetZh : target.headword;
    const distractorTexts = distractors.map((d) =>
      direction === 'en-to-zh' ? primarySenseZh(d)! : d.headword,
    );

    const entries = shuffle(
      [
        { text: correctText, wordId: target.id, correct: true },
        ...distractorTexts.map((text, i) => ({
          text,
          wordId: distractors[i]!.id,
          correct: false,
        })),
      ],
      rand,
    );

    // ★ 二次去重：洗牌后仍可能出现重复文本（不同词的释义撞车）→ 直接弃题
    if (new Set(entries.map((e) => norm(e.text))).size !== entries.length) continue;

    const options: QuizOption[] = entries.map((e, i) => ({
      key: KEYS[i] ?? 'D',
      text: e.text,
      wordId: e.wordId,
    }));
    const answerIndex = entries.findIndex((e) => e.correct);

    questions.push({
      id: `q_${target.id}_${direction}`,
      wordId: target.id,
      direction,
      stem: direction === 'en-to-zh' ? target.headword : targetZh,
      options,
      answerKey: options[answerIndex]!.key,
      distractorWordIds: distractors.map((d) => d.id),
    });
  }

  return questions;
}
