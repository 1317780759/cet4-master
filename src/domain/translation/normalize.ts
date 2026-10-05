/**
 * 英文归一化 —— 分词 / 大小写 / 标点 / 收缩 / 词形还原-lite。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.5.1。
 *
 * ★ 三条不可动摇的纪律：
 *   1. **归一化只用于匹配，绝不用于显示** —— UI 高亮一律用 `Token.start/end`
 *      定位**用户原文**里的片段（所以它俩必须指向原文字符区间）。
 *   2. **候选集合永远包含原形** —— 保证「原样命中」永不丢失（宁松勿紧）。
 *   3. **禁止引入 stemmer 依赖** —— 表驱动 + 保守后缀规则，全部可单测。
 */

/** 一个词。`start/end` 是**原文**字符区间（`[start, end)`），供 UI 高亮 */
export interface Token {
  /** 归一化后的匹配用小写词形（撇号收缩已展开，不含标点） */
  text: string;
  /** 原文起始下标（含） */
  start: number;
  /** 原文结束下标（不含） */
  end: number;
}

/** 减词后缀生成的词干最小长度 —— 低于此值不做还原，避免 `thing → the` 这类过度还原 */
const MIN_STEM_LEN = 3;

/** 原形词整体最短长度 —— 短于此值直接不做后缀还原 */
const MIN_WORD_LEN = 4;

/** 允许「双写还原」的辅音（`running → run`、`stopped → stop`）。排除 s/l/f/z 以免 `tell → tel` */
const DOUBLABLE_CONSONANTS = /^[bdgmnprt]$/;

/**
 * 确定否定收缩表（~23 条）。
 *
 * ★ 最小惊讶原则：**只展开确定的否定收缩**，`'s` / `'ve` / `'re` / `'ll` 一律不动
 *   （`it's` 不拆成 `it is`）；`cannot` 虽非撇号收缩但语义确定，一并展开。
 */
export const CONTRACTIONS: Readonly<Record<string, string>> = {
  "ain't": 'is not',
  "aren't": 'are not',
  "can't": 'can not',
  "couldn't": 'could not',
  "daren't": 'dare not',
  "didn't": 'did not',
  "doesn't": 'does not',
  "don't": 'do not',
  "hadn't": 'had not',
  "hasn't": 'has not',
  "haven't": 'have not',
  "isn't": 'is not',
  "mightn't": 'might not',
  "mustn't": 'must not',
  "needn't": 'need not',
  "oughtn't": 'ought not',
  "shan't": 'shall not',
  "shouldn't": 'should not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "won't": 'will not',
  "wouldn't": 'would not',
  cannot: 'can not',
};

/**
 * 不规则词形表（~70 条）。key = 变形，value = 还原目标。
 *
 * ★ 只做**加法**：命中后同时保留原形，因此本表宁可多列也不会造成误判丢失。
 */
export const IRREGULAR: Readonly<Record<string, string>> = {
  // ── be / have / do ──────────────────────────────────────────
  am: 'be',
  is: 'be',
  are: 'be',
  was: 'be',
  were: 'be',
  been: 'be',
  being: 'be',
  has: 'have',
  had: 'have',
  having: 'have',
  does: 'do',
  did: 'do',
  done: 'do',
  goes: 'go',
  went: 'go',
  gone: 'go',
  // ── 常见不规则动词 ──────────────────────────────────────────
  ate: 'eat',
  eaten: 'eat',
  began: 'begin',
  begun: 'begin',
  broke: 'break',
  broken: 'break',
  brought: 'bring',
  built: 'build',
  bought: 'buy',
  caught: 'catch',
  chose: 'choose',
  chosen: 'choose',
  drank: 'drink',
  drunk: 'drink',
  fell: 'fall',
  fallen: 'fall',
  flew: 'fly',
  flown: 'fly',
  forgot: 'forget',
  forgotten: 'forget',
  found: 'find',
  fought: 'fight',
  gave: 'give',
  given: 'give',
  got: 'get',
  gotten: 'get',
  hid: 'hide',
  kept: 'keep',
  knew: 'know',
  known: 'know',
  lain: 'lie',
  lay: 'lie',
  led: 'lead',
  left: 'leave',
  lost: 'lose',
  made: 'make',
  meant: 'mean',
  met: 'meet',
  paid: 'pay',
  ran: 'run',
  rode: 'ride',
  ridden: 'ride',
  rose: 'rise',
  risen: 'rise',
  sang: 'sing',
  sung: 'sing',
  sank: 'sink',
  sat: 'sit',
  saw: 'see',
  seen: 'see',
  sent: 'send',
  slept: 'sleep',
  spoke: 'speak',
  spoken: 'speak',
  spent: 'spend',
  stood: 'stand',
  stuck: 'stick',
  swept: 'sweep',
  swam: 'swim',
  took: 'take',
  taken: 'take',
  taught: 'teach',
  told: 'tell',
  thought: 'think',
  understood: 'understand',
  woke: 'wake',
  won: 'win',
  wore: 'wear',
  worn: 'wear',
  wrote: 'write',
  written: 'write',
  // ── 不规则名词复数 ──────────────────────────────────────────
  children: 'child',
  feet: 'foot',
  geese: 'goose',
  knives: 'knife',
  leaves: 'leaf',
  lives: 'life',
  men: 'man',
  mice: 'mouse',
  people: 'person',
  selves: 'self',
  teeth: 'tooth',
  wives: 'wife',
  wolves: 'wolf',
  halves: 'half',
  shelves: 'shelf',
  thieves: 'thief',
  loaves: 'loaf',
  phenomena: 'phenomenon',
  criteria: 'criterion',
  analyses: 'analysis',
  // ── 形容词比较级 ────────────────────────────────────────────
  better: 'good',
  best: 'good',
  worse: 'bad',
  worst: 'bad',
  less: 'little',
  least: 'little',
  further: 'far',
  farthest: 'far',
  elder: 'old',
  // ── 派生词还原（名词 ↔ 形容词，CET-4 高频）────────────────
  cultural: 'culture',
  traditional: 'tradition',
  natural: 'nature',
  national: 'nation',
  environmental: 'environment',
  governmental: 'government',
  personal: 'person',
  global: 'globe',
  economic: 'economy',
  economical: 'economy',
  social: 'society',
  historical: 'history',
  scientific: 'science',
  educational: 'education',
  industrial: 'industry',
  agricultural: 'agriculture',
  healthy: 'health',
  wealthy: 'wealth',
  friendly: 'friend',
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
  development: 'develop',
  government: 'govern',
  protection: 'protect',
  pollution: 'pollute',
  education: 'educate',
  information: 'inform',
  communication: 'communicate',
  transportation: 'transport',
  urbanization: 'urban',
  modernization: 'modern',
  globalization: 'global',
  convenience: 'convenient',
  importance: 'important',
  difference: 'different',
  difficulty: 'difficult',
  safety: 'safe',
  variety: 'vary',
  ability: 'able',
  activity: 'active',
  creativity: 'creative',
  popularity: 'popular',
  using: 'use',
};

/** 原始词块：连续的字母/数字，允许内部带撇号（`don't`、`o'clock` 不被切开） */
const RAW_TOKEN_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/**
 * 基础归一化：NFKC + 弯撇号 → 直撇号 + 转小写。
 *
 * ★ 只作用在**单个词块**上，绝不整段替换 —— 否则 NFKC 可能改变字符串长度，
 *   使 `Token.start/end` 与原文错位（高亮会飘）。
 */
function basicNormalize(raw: string): string {
  return raw.normalize('NFKC').replace(/’/g, "'").toLowerCase();
}

/** 去掉首尾撇号（`'tis` / `students'` 场景下的残留） */
function stripEdgeApostrophes(word: string): string {
  return word.replace(/^'+/, '').replace(/'+$/, '');
}

/**
 * 收缩展开 → 1..n 个子词。未命中表时按 `Xn't` 兜底拆成 `X` + `not`。
 *
 * 例：`isn't → ['is','not']`；`cannot → ['can','not']`；`it's → ["it's"]`（不动）。
 */
export function splitContraction(word: string): string[] {
  const expanded = CONTRACTIONS[word];
  if (expanded) return expanded.split(' ');
  const matched = /^([a-z]{2,})n't$/.exec(word);
  if (matched) return [matched[1] as string, 'not'];
  return [word];
}

/** 双写还原判定：末尾两个相同辅音（如 `runn` / `stopp`） */
function isDoubledConsonant(stem: string): boolean {
  if (stem.length < 2) return false;
  const last = stem[stem.length - 1] as string;
  return last === stem[stem.length - 2] && DOUBLABLE_CONSONANTS.test(last);
}

/**
 * 后缀还原候选（不含原形，原形由调用方负责先入集合）。
 *
 * 规则顺序固定：`-ies` → `-es` → `-ed` → `-ing` → `-s`，先命中者返回。
 */
function suffixCandidates(word: string): string[] {
  const out: string[] = [];
  const add = (candidate: string): void => {
    if (candidate.length >= MIN_STEM_LEN && !out.includes(candidate)) out.push(candidate);
  };

  if (word.length < MIN_WORD_LEN) return out;
  // 只处理纯小写英文词（含撇号的变形不走后缀规则，改由撇号拆分处理）
  if (!/^[a-z]+$/.test(word)) return out;

  // 1) -ies → y：studies → study / studie
  if (word.endsWith('ies')) {
    add(`${word.slice(0, -3)}y`);
    add(word.slice(0, -1));
    return out;
  }

  // 2) -es（ss / x / ch / sh / o 后）→ 去 es：boxes → box / boxe
  if (word.endsWith('es') && /(?:ss|x|ch|sh|o)es$/.test(word)) {
    add(word.slice(0, -2));
    add(word.slice(0, -1));
    return out;
  }

  // 3) -ed → 去 ed / 去 d；-ied → y：studied → study
  if (word.endsWith('ed')) {
    const withoutEd = word.slice(0, -2);
    const withoutD = word.slice(0, -1);
    add(withoutEd);
    add(withoutD);
    if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`);
    if (isDoubledConsonant(withoutEd)) add(withoutEd.slice(0, -1));
    if (isDoubledConsonant(withoutD)) add(withoutD.slice(0, -1));
    return out;
  }

  // 4) -ing → 去 ing：running → runn → run；making → mak → make
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    add(stem);
    if (isDoubledConsonant(stem)) {
      // ★ 双写辅音词干：只做去重双写，**不做 +e 还原**
      //   —— 否则 running → runn + e = rune，正是 §5.5.1 明令禁止的过度还原。
      add(stem.slice(0, -1));
    } else if (stem.length >= MIN_STEM_LEN) {
      // +e 还原（making → make）。★ 词干过短时跳过，否则 thing → the 之类的噪声会进来。
      add(`${stem}e`);
    }
    return out;
  }

  // 5) -s（非 ss）→ 去 s：books → book
  if (word.endsWith('s') && !word.endsWith('ss')) {
    add(word.slice(0, -1));
  }
  return out;
}

/** 收集单个词的全部候选键 */
function collectCandidates(word: string, out: string[], seen: Set<string>): void {
  const push = (candidate: string): void => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  push(word);
  const irregular = IRREGULAR[word];
  if (irregular) push(irregular);
  for (const candidate of suffixCandidates(word)) push(candidate);
}

/**
 * 归一化单个词 → **候选匹配键集合**（去重，原形永远排在第一位）。
 *
 * 例：
 *   `normalizeToken('Studies')` → `['studies', 'study', 'studie']`
 *   `normalizeToken('running')` → `['running', 'runn', 'run']`（**不含 `rune`**）
 *   `normalizeToken("china's")` → `["china's", 'china']`
 */
export function normalizeToken(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const base = stripEdgeApostrophes(basicNormalize(raw));
  if (!base) return out;

  // 原形（保证「原样命中」永不丢失）
  collectCandidates(base, out, seen);

  // 撇号拆分：o'clock → clock；china's → china
  if (base.includes("'")) {
    for (const part of base.split("'")) {
      if (part.length >= 2) collectCandidates(part, out, seen);
    }
  }

  // 收缩展开：isn't → is / not
  for (const sub of splitContraction(base)) {
    collectCandidates(sub, out, seen);
  }

  return out;
}

/**
 * 英文分词。
 *
 * ★ 标点一律作分隔符，`-` 天然把词拆成两个（`well-known → [well, known]`）。
 * ★ 收缩会被展开成多个 Token，它们**共享同一原文区间** —— 这样
 *   `isn't` 既能命中单词得分点 `not`，也能参与多词词组的窗口匹配。
 */
export function tokenizeEn(text: string): Token[] {
  const tokens: Token[] = [];
  if (typeof text !== 'string' || text.length === 0) return tokens;

  for (const matched of text.matchAll(RAW_TOKEN_PATTERN)) {
    const start = matched.index ?? 0;
    const end = start + matched[0].length;
    for (const word of splitContraction(basicNormalize(matched[0]))) {
      if (word.length > 0) tokens.push({ text: word, start, end });
    }
  }
  return tokens;
}

/** 取一个词的候选键集合（Set 形式，供匹配时做交集） */
export function candidateSetOf(raw: string): Set<string> {
  return new Set(normalizeToken(raw));
}
