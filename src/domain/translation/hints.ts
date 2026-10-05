/**
 * 提示层级 —— 纯函数（铁律 A1：零 React / 零 IO / 零日期）。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.10.3（题库写作规范）+ §5.11（UI 流程）。
 *
 * ★ 为什么提示要"一级一级给"而不是一次全给：
 *   直接把 `keyPoints` 摊开等于把答案写在题面上 —— 用户照着拼一遍，
 *   练到的是"抄写"而不是"翻译"。分级揭示保留了"自己先想"的那一步，
 *   想不出来再看下一级。
 *
 * ★ 缺省兜底：`TranslationItem.hints` 是可选字段（人工撰写时可能不给），
 *   此时由 `keyPoints` 自动合成第1 级（得分点清单），保证 UI 永远至少有提示可用。
 */

import type { TranslationItem } from './types';

/** 提示最多三级（与 `TranslationItem.hints` 的约定一致） */
export const MAX_HINT_LEVELS = 3;

/**
 * 取一条题目的全部提示文本（已按级序、已去重、已过滤空串）。
 *
 * @returns 长度 0..`MAX_HINT_LEVELS`；返回空数组表示这条题没有任何提示可用
 *   （UI 应据此**隐藏**提示按钮，而不是渲染一个点了没反应的按钮）
 */
export function hintLevels(item: TranslationItem): string[] {
  const authored = Array.isArray(item.hints) ? item.hints : [];
  const levels = authored
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
    .map((text) => text.trim());

  // ★ 人工提示一条都没给时，用得分点合成第 1 级 —— 至少让"提示"这个动作有意义
  if (levels.length === 0) {
    const heads = item.keyPoints
      .map((point) => point.head)
      .filter((head): head is string => typeof head === 'string' && head.trim().length > 0);
    if (heads.length > 0) levels.push(`得分点：${heads.join(' / ')}`);
  }

  return levels.slice(0, MAX_HINT_LEVELS);
}

/**
 * 该题是否有可展示的提示。
 *
 * 单独出一个函数而不是让 UI 判断 `hintLevels(item).length > 0`，
 * 是为了让"按钮显不显示"这个决定有一处可单测的落点。
 */
export function hasHints(item: TranslationItem): boolean {
  return hintLevels(item).length > 0;
}