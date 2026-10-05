/**
 * ★ 金标准回归集（20 条人工标注）—— 翻译评分的"账本"。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §6.3 V-05 DoD。
 *
 * 纪律（写死在这里，防止后人偷懒）：
 *   1. 每条 `expected` 都是**人工标注**的，不是"跑一遍把输出抄下来"；
 *   2. 调整 `BAND_TABLE` / `KEYWORD_WEIGHT` / `IRREGULAR` / `CONTRACTIONS` 后，
 *      若本文件断言失败，**必须逐条人工复核是否该改预期**，而不是直接改数字；
 *   3. 覆盖档位边界 0.95 / 0.80 / 0.60 / 0.40 与 consumed 去重等结构性用例。
 *
 * 所有中文题干与参考译文均为**教学用途自撰**，不含任何真题原文。
 */

import type { Band, KeyPoint } from '../types';

export interface GoldenCase {
  id: string;
  /** 标注理由（人工），便于回归失败时快速判断是"算法变了"还是"标注错了" */
  note: string;
  zh: string;
  keyPoints: KeyPoint[];
  /** 用户译文 */
  text: string;
  expected: {
    hit: number;
    total: number;
    ratio: number;
    band: Band;
  };
}

/** 经济发展 / 环保（4 得分点，权重 2/1/2/1，满分 6） */
const ECONOMY_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'with the development of', zh: '随着……的发展', weight: 2 },
  { id: 'kp2', head: 'more and more', zh: '越来越多的', weight: 1 },
  { id: 'kp3', head: 'pay attention to', zh: '关注', weight: 2 },
  { id: 'kp4', head: 'environment', zh: '环境', weight: 1 },
];

/** 教育 / 重要作用（4 得分点，含 optional） */
const EDUCATION_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'play an important role in', zh: '在……中起重要作用', weight: 2 },
  { id: 'kp2', head: 'education', zh: '教育', weight: 1 },
  { id: 'kp3', head: 'economic development', zh: '经济发展', weight: 2 },
  { id: 'kp4', head: 'increasingly', zh: '越来越', weight: 1, optional: true },
];

/** 传统文化传承 */
const CULTURE_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'traditional culture', zh: '传统文化', weight: 2 },
  { id: 'kp2', head: 'pass down', zh: '传承', synonyms: ['hand down'], weight: 1 },
  { id: 'kp3', head: 'generation', zh: '一代人', weight: 1 },
  { id: 'kp4', head: 'young people', zh: '年轻人', weight: 1 },
];

/** 环保 / 政府举措（含同义词） */
const PROTECT_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'protect', zh: '保护', synonyms: ['preserve', 'safeguard'], weight: 1 },
  { id: 'kp2', head: 'environment', zh: '环境', weight: 1 },
  { id: 'kp3', head: 'government', zh: '政府', weight: 1 },
  { id: 'kp4', head: 'take measures', zh: '采取措施', weight: 2 },
];

/** 互联网 / 日常生活 */
const INTERNET_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'with the rapid development of', zh: '随着……的快速发展', weight: 2 },
  { id: 'kp2', head: 'internet', zh: '互联网', weight: 1 },
  { id: 'kp3', head: 'play an important role in', zh: '在……中起重要作用', weight: 2 },
  { id: 'kp4', head: 'daily life', zh: '日常生活', weight: 1 },
];

/** 网上购物 */
const SHOPPING_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'more and more', zh: '越来越多的', weight: 1 },
  { id: 'kp2', head: 'prefer to', zh: '更喜欢', weight: 1 },
  { id: 'kp3', head: 'online shopping', zh: '网上购物', weight: 2 },
  { id: 'kp4', head: 'convenient', zh: '方便的', weight: 1 },
];

/** 体育运动 */
const SPORTS_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'running', zh: '跑步', weight: 1 },
  { id: 'kp2', head: 'marathon', zh: '马拉松', weight: 1 },
  { id: 'kp3', head: 'take part in', zh: '参加', weight: 2 },
  { id: 'kp4', head: 'health', zh: '健康', weight: 1 },
];

/** 学习 / 考试 */
const STUDY_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'study', zh: '学习', weight: 1 },
  { id: 'kp2', head: 'hard', zh: '努力', weight: 1 },
  { id: 'kp3', head: 'exam', zh: '考试', weight: 1 },
  { id: 'kp4', head: 'pass', zh: '通过', weight: 2 },
];

/** ★ consumed 结构用例：单词 `development` 与多词 `rapid development` 竞争 */
const CONSUMED_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'development', zh: '发展', weight: 1 },
  { id: 'kp2', head: 'rapid development', zh: '快速发展', weight: 2 },
  { id: 'kp3', head: 'economy', zh: '经济', weight: 1 },
  { id: 'kp4', head: 'living standard', zh: '生活水平', weight: 1, optional: true },
];

/** 重复词用例 */
const REPEAT_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'important', zh: '重要的', weight: 1 },
  { id: 'kp2', head: 'education', zh: '教育', weight: 1 },
  { id: 'kp3', head: 'future', zh: '未来', weight: 1 },
];

/** 节日习俗（含 optional 未命中） */
const FESTIVAL_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'traditional festival', zh: '传统节日', weight: 2 },
  { id: 'kp2', head: 'celebrate', zh: '庆祝', weight: 1 },
  { id: 'kp3', head: 'family reunion', zh: '家庭团聚', weight: 2 },
  { id: 'kp4', head: 'mooncake', zh: '月饼', weight: 1, optional: true },
  { id: 'kp5', head: 'symbol', zh: '象征', weight: 1 },
];

/** 环保举措（band 1 边界：2/4 = 0.5） */
const MEASURE_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'protect', zh: '保护', weight: 1 },
  { id: 'kp2', head: 'environment', zh: '环境', weight: 1 },
  { id: 'kp3', head: 'government', zh: '政府', weight: 1 },
  { id: 'kp4', head: 'take measures', zh: '采取措施', weight: 1 },
];

/** 互联网沟通（band 2 边界：3/5 = 0.6） */
const COMMUNICATION_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'the internet', zh: '互联网', weight: 1 },
  { id: 'kp2', head: 'change', zh: '改变', weight: 1 },
  { id: 'kp3', head: 'communicate', zh: '交流', weight: 1 },
  { id: 'kp4', head: 'convenient', zh: '方便的', weight: 1 },
  { id: 'kp5', head: 'information', zh: '信息', weight: 1 },
];

/** ★ band 4 边界：10 / 10.5 ≈ 0.9524（刚好过 0.95） */
const IMPORTANCE_POINTS: KeyPoint[] = [
  { id: 'kp1', head: 'with the development of', zh: '随着……的发展', weight: 2 },
  { id: 'kp2', head: 'more and more', zh: '越来越多的', weight: 2 },
  { id: 'kp3', head: 'realize the importance of', zh: '意识到……的重要性', weight: 2 },
  { id: 'kp4', head: 'protect', zh: '保护', weight: 2 },
  { id: 'kp5', head: 'environment', zh: '环境', weight: 2 },
  { id: 'kp6', head: 'government', zh: '政府', weight: 1, optional: true },
];

export const GOLDEN_CASES: readonly GoldenCase[] = [
  {
    id: 'G01',
    note: '满分：4 个得分点全命中（含 2 个多词词组）',
    zh: '随着经济的发展，越来越多的人关注环境。',
    keyPoints: ECONOMY_POINTS,
    text: 'With the development of economy, more and more people pay attention to the environment.',
    expected: { hit: 4, total: 4, ratio: 1, band: 4 },
  },
  {
    id: 'G02',
    note: '漏 1 个权重 1 的词组 → 5/6 ≈ 0.8333 → 3 档',
    zh: '随着经济的发展，越来越多的人关注环境。',
    keyPoints: ECONOMY_POINTS,
    text: 'With the development of economy, people pay attention to the environment.',
    expected: { hit: 3, total: 4, ratio: 0.8333, band: 3 },
  },
  {
    id: 'G03',
    note: '漏 1 个权重 2 的核心词组 → 4/6 ≈ 0.6667 → 2 档',
    zh: '随着经济的发展，越来越多的人关注环境。',
    keyPoints: ECONOMY_POINTS,
    text: 'More and more people pay attention to the environment.',
    expected: { hit: 3, total: 4, ratio: 0.6667, band: 2 },
  },
  {
    id: 'G04',
    note: '只命中 1 个权重 1 的实词 → 1/6 ≈ 0.1667 → 0 档',
    zh: '随着经济的发展，越来越多的人关注环境。',
    keyPoints: ECONOMY_POINTS,
    text: 'The environment is good.',
    expected: { hit: 1, total: 4, ratio: 0.1667, band: 0 },
  },
  {
    id: 'G05',
    note: 'optional 未命中按 0.5 折入分母 → 5/5.5 ≈ 0.9091 → 3 档',
    zh: '教育在经济发展中起着越来越重要的作用。',
    keyPoints: EDUCATION_POINTS,
    text: 'Education plays an important role in economic development.',
    expected: { hit: 3, total: 4, ratio: 0.9091, band: 3 },
  },
  {
    id: 'G06',
    note: '同上题但 optional 也命中 → 满分',
    zh: '教育在经济发展中起着越来越重要的作用。',
    keyPoints: EDUCATION_POINTS,
    text: 'Increasingly, education plays an important role in economic development.',
    expected: { hit: 4, total: 4, ratio: 1, band: 4 },
  },
  {
    id: 'G07',
    note: '多词词组相邻命中；单词 generation 命中首次出现；young people 未写 → 4/5 = 0.8',
    zh: '我们应该把传统文化代代相传。',
    keyPoints: CULTURE_POINTS,
    text: 'We should pass down our traditional culture from generation to generation.',
    expected: { hit: 3, total: 4, ratio: 0.8, band: 3 },
  },
  {
    id: 'G08',
    note: "同义词 preserve 命中 protect；doesn't 展开为 does + not 不干扰匹配",
    zh: '政府应该采取措施保护环境。',
    keyPoints: PROTECT_POINTS,
    text: "The government doesn't preserve the environment or take measures.",
    expected: { hit: 4, total: 4, ratio: 1, band: 4 },
  },
  {
    id: 'G09',
    note: '全大写 + 多余空格 + 换行；plays 还原为 play',
    zh: '随着互联网的快速发展，它在我们的日常生活中起着重要作用。',
    keyPoints: INTERNET_POINTS,
    text: 'WITH   THE   RAPID\nDEVELOPMENT   OF   THE   INTERNET,   IT   PLAYS   AN   IMPORTANT   ROLE   IN   OUR   DAILY   LIFE.',
    expected: { hit: 4, total: 4, ratio: 1, band: 4 },
  },
  {
    id: 'G10',
    note: '中文标点（，。）混排：标点一律作分隔符',
    zh: '越来越多的人更喜欢网上购物，因为它很方便。',
    keyPoints: SHOPPING_POINTS,
    text: 'More and more people prefer to do online shopping，because it is convenient。',
    expected: { hit: 4, total: 4, ratio: 1, band: 4 },
  },
  {
    id: 'G11',
    note: '词形还原：marathons→marathon、healthy→health',
    zh: '跑步是保持健康的好方法，很多人参加马拉松。',
    keyPoints: SPORTS_POINTS,
    text: 'Running is a good way to keep healthy, and many people take part in marathons.',
    expected: { hit: 4, total: 4, ratio: 1, band: 4 },
  },
  {
    id: 'G12',
    note: '词形还原：studies→study、passed→pass',
    zh: '她努力学习并通过了考试。',
    keyPoints: STUDY_POINTS,
    text: 'She studies hard and passed the exam.',
    expected: { hit: 4, total: 4, ratio: 1, band: 4 },
  },
  {
    id: 'G13',
    note: '★ consumed：development 被多词词组占用，单词得分点不得重复计分 → 4/5 = 0.8',
    zh: '随着经济的快速发展，我们的生活水平提高了。',
    keyPoints: CONSUMED_POINTS,
    text: 'With the rapid development of the economy, our living standard has improved.',
    expected: { hit: 3, total: 4, ratio: 0.8, band: 3 },
  },
  {
    id: 'G14',
    note: '空输入：全不命中，分母仍是满分权重',
    zh: '随着经济的发展，越来越多的人关注环境。',
    keyPoints: ECONOMY_POINTS,
    text: '',
    expected: { hit: 0, total: 4, ratio: 0, band: 0 },
  },
  {
    id: 'G15',
    note: '空 keyPoints 防御：total 0、ratio 0、band 0，不得除零崩溃',
    zh: '（防御用例）',
    keyPoints: [],
    text: 'Anything the user typed.',
    expected: { hit: 0, total: 0, ratio: 0, band: 0 },
  },
  {
    id: 'G16',
    note: '同一词重复三次只算一次命中',
    zh: '教育对未来很重要。',
    keyPoints: REPEAT_POINTS,
    text: 'Education is important, important, and important for the future.',
    expected: { hit: 3, total: 3, ratio: 1, band: 4 },
  },
  {
    id: 'G17',
    note: '只命中 celebrate；optional 的 mooncake 按 0.5 折入 → 1/6.5 ≈ 0.1538',
    zh: '人们在传统节日吃月饼，象征家庭团聚。',
    keyPoints: FESTIVAL_POINTS,
    text: 'People celebrate the festival with their families.',
    expected: { hit: 1, total: 5, ratio: 0.1538, band: 0 },
  },
  {
    id: 'G18',
    note: 'band 1 边界：2/4 = 0.5',
    zh: '政府应该采取措施保护环境。',
    keyPoints: MEASURE_POINTS,
    text: 'The government should protect it.',
    expected: { hit: 2, total: 4, ratio: 0.5, band: 1 },
  },
  {
    id: 'G19',
    note: 'band 2 边界：3/5 = 0.6；changes→change 走 -s 还原',
    zh: '互联网改变了我们交流的方式。',
    keyPoints: COMMUNICATION_POINTS,
    text: 'The internet changes the way we communicate.',
    expected: { hit: 3, total: 5, ratio: 0.6, band: 2 },
  },
  {
    id: 'G20',
    note: '★ band 4 边界：10/10.5 ≈ 0.9524（刚好 ≥ 0.95）；protecting→protect 走 -ing 还原',
    zh: '随着社会的发展，越来越多的人意识到保护环境的重要性。',
    keyPoints: IMPORTANCE_POINTS,
    text: 'With the development of society, more and more people realize the importance of protecting the environment.',
    expected: { hit: 5, total: 6, ratio: 0.9524, band: 4 },
  },
];
