/**
 * 15 个四级常考话题（key + 中文标签）。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.10.2。
 * 只放常量与纯派生函数，不放任何 IO / React（铁律 A1）。
 */

import type { TranslationTopic, TranslationTopicKey } from './types';

/** 话题 key 顺序 = UI 展示顺序（人工排序，勿随意调整） */
export const TRANSLATION_TOPIC_KEYS = [
  'trad-culture',
  'festival',
  'food',
  'economy',
  'tech',
  'health',
  'travel',
  'education',
  'environment',
  'urbanisation',
  'transport',
  'internet',
  'employment',
  'aging',
  'sports',
] as const;

/** key → 中文标签。与 `TRANSLATION_TOPIC_KEYS` 一一对应，缺一即编译报错 */
export const TRANSLATION_TOPIC_LABEL: Readonly<Record<TranslationTopicKey, string>> = {
  'trad-culture': '传统文化',
  festival: '节日习俗',
  food: '饮食文化',
  economy: '经济发展',
  tech: '科技成就',
  health: '健康医疗',
  travel: '旅游观光',
  education: '教育考试',
  environment: '环境保护',
  urbanisation: '城市化',
  transport: '交通出行',
  internet: '互联网',
  employment: '就业创业',
  aging: '人口老龄化',
  sports: '体育运动',
};

/** 话题列表（key + 标签），UI 直接遍历渲染 */
export const TRANSLATION_TOPICS: readonly TranslationTopic[] = TRANSLATION_TOPIC_KEYS.map(
  (key) => ({ key, label: TRANSLATION_TOPIC_LABEL[key] }),
);

/** 话题总数 */
export const TRANSLATION_TOPIC_COUNT = TRANSLATION_TOPICS.length;

/** 运行时守卫：把来自 JSON / URL 的 `string` 收敛成 `TranslationTopicKey` */
export function isTranslationTopicKey(value: string): value is TranslationTopicKey {
  return (TRANSLATION_TOPIC_KEYS as readonly string[]).includes(value);
}

/**
 * 话题标签查询。
 *
 * ★ 未知 key 回退为 `'综合'` 而不是抛错 —— 话题是**展示属性**，
 *   遇到脏数据（老备份、手工编辑的 JSON）应降级显示而非让整页崩掉。
 */
export function translationTopicLabel(key: string): string {
  return isTranslationTopicKey(key) ? TRANSLATION_TOPIC_LABEL[key] : '综合';
}
