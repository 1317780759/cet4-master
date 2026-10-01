/**
 * ID 工具。
 *
 * ★ 关键约定：`slugify` 生成的**词 ID 与 freqRank 完全解耦**。
 * 换数据源、词频重排时 headword 不变 → id 不变 → 用户进度（cards/wrongBook）零损伤。
 * 这是实现方案「硬约束 6」的落点。
 */

/**
 * headword → 稳定 slug。'X-ray' → 'X_ray'，'o'clock' → 'o_clock'。
 *
 * ★ 刻意**不**做小写化与去重音：考纲里 `may`（可能）与 `May`（五月）、
 * `march`（行进）与 `March`（三月）、`resume`（恢复）与 `résumé`（简历）
 * 都是**各自独立的词条**。若按大小写/重音归一化，会静默吞掉一个词。
 * 大小写不敏感的匹配交给查询侧（variants / 搜索）处理，不混进主键。
 */
export function slugify(input: string): string {
  return input
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** 词 ID */
export function wordId(headword: string): string {
  return `w_${slugify(headword)}`;
}

/** 通用唯一 ID（时间戳 + 随机后缀，无第三方依赖） */
export function uid(prefix = 'id'): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${rand}`;
}

/** 例句 ID（M1 例句管线启用后使用） */
export function sentenceId(seq: number): string {
  return `s_${`${seq}`.padStart(6, '0')}`;
}
