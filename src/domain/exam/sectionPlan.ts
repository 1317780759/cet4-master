/**
 * 板块计划 —— M2 架构核心「`sectionMeta` 驱动的可恢复性契约」（docs/04 第 2 章）。
 *
 * 铁律 A1：纯类型 + 纯函数，零 React、零 IO、零 Date。
 *
 * ★ 三条硬约束（写进 Code Review，违反等于把听力写死在代码里）：
 *   - **K1** 板块渲染只能遍历 `plan.slots`（源自 `sectionMeta`），禁止 `['writing','reading','translation']` 字面量数组
 *   - **K2** 分段倒计时与总时长只能取 `plan.totalSec`，禁止 `const TOTAL = 100 * 60`
 *   - **K3** 答题卡分组 / 题号区间只能读 `slot.questionFrom/To`，禁止按 kind 硬编码题号
 *
 * ★ 为什么必须走 plan（而不是直接读 sectionMeta）：
 *   这样本期「听力停用」只是 `DEFAULT_DISABLED_SECTIONS` 里的一个值。
 *   将来把它改成 `[]`，slots 自动变 4 个、总时长自动回到 125 分钟 —— **零代码改动**。
 *   这条契约由 `sectionPlan.test.ts` 的往返测试守护（docs/04 §2.6）；**它红了就说明有人把三板块写死了**。
 */

import type { ExamPaper, ExamSectionKind, ExamSectionMeta } from './types';

/** 一个启用板块的渲染 / 计时槽位 */
export interface SectionSlot {
  meta: ExamSectionMeta;
  /** 建议用时（秒）——直接取自 meta.durationHintSec（缺则为 0，见 durationSource） */
  durationSec: number;
  /** 该槽位占用的题号区间（答题卡分组用，K3 唯一来源） */
  questionFrom: number;
  questionTo: number;
  /** 该槽位内的题数（= questionTo - questionFrom + 1），用于进度显示 */
  questionCount: number;
}

/**
 * 总时长的推导来源（docs/04 §2.5 三级优先级）。
 * UI 可对非 'sum' 标注「时长按考试规格」。
 */
export type DurationSource =
  /** ① Σ 启用板块的 durationHintSec（首选） */
  | 'sum'
  /** ② 规格时长 − Σ 停用板块时长（某启用板块缺 durationHintSec 时的兜底） */
  | 'spec-minus-disabled'
  /** ③ 直接用规格时长（①/② 都不可用时，最保守） */
  | 'spec';

/** 一次练习的完整板块计划 —— 所有 UI 的唯一数据源 */
export interface SectionPlan {
  /** 仅启用板块，按 meta.order 升序 */
  slots: SectionSlot[];
  /** ★ 实际总时长（秒）—— 倒计时唯一来源，禁止在别处再算一次 */
  totalSec: number;
  /** 考试规格时长（秒）= paper.durationMin * 60，仅用于「真实考试 125 分钟」对照展示，**不参与倒计时** */
  specSec: number;
  /** 本期停用的板块（含 'listening'），用于 UI 显式占位（T1 / T11） */
  disabledKinds: ExamSectionKind[];
  /** ② / ③ 表示走的是兜底路径，UI 应如实标注而非假装精算 */
  durationSource: DurationSource;
}

/**
 * 本期停用清单 —— ★ 唯一"知道听力被停用"的地方，集中可查。
 * 将来恢复听力：把这里改成 `[]`（或改为读取用户配置），其余代码不动。
 */
export const DEFAULT_DISABLED_SECTIONS: readonly ExamSectionKind[] = ['listening'];

function hasDuration(meta: ExamSectionMeta): boolean {
  return typeof meta.durationHintSec === 'number';
}

/**
 * 由 sectionMeta 推导板块计划 —— K1–K3 的唯一实现处，其余地方一律消费它的产物。
 *
 * 纯函数：无 IO、无 React、无 Date；**不修改入参**（sort 前先 `slice()`）。
 */
export function buildSectionPlan(
  paper: ExamPaper,
  disabled: readonly ExamSectionKind[] = DEFAULT_DISABLED_SECTIONS,
): SectionPlan {
  const disabledSet = new Set(disabled);

  // ⚠️ `sort()` 会原地改数组，先复制以免污染 paper.sectionMeta
  const enabled = paper.sectionMeta
    .filter((m) => !disabledSet.has(m.kind))
    .slice()
    .sort((a, b) => a.order - b.order);
  const disabledMetas = paper.sectionMeta
    .filter((m) => disabledSet.has(m.kind))
    .slice()
    .sort((a, b) => a.order - b.order);

  const specSec = paper.durationMin * 60;
  const enabledAllHaveDuration = enabled.every(hasDuration);
  const disabledAllHaveDuration = disabledMetas.every(hasDuration);
  const sumEnabled = enabled.reduce((s, m) => s + (m.durationHintSec ?? 0), 0);
  const sumDisabled = disabledMetas.reduce((s, m) => s + (m.durationHintSec ?? 0), 0);

  // docs/04 §2.5：三级优先级
  let totalSec: number;
  let durationSource: DurationSource;
  if (enabledAllHaveDuration) {
    // ① 首选
    totalSec = sumEnabled;
    durationSource = 'sum';
  } else if (disabledMetas.length > 0 && disabledAllHaveDuration) {
    // ② 启用板块缺建议用时，但停用板块齐全 → 用规格时长反推
    totalSec = specSec - sumDisabled;
    durationSource = 'spec-minus-disabled';
  } else {
    // ③ 兜底
    totalSec = specSec;
    durationSource = 'spec';
  }

  const slots: SectionSlot[] = enabled.map((m) => ({
    meta: m,
    durationSec: m.durationHintSec ?? 0,
    questionFrom: m.questionFrom,
    questionTo: m.questionTo,
    questionCount: m.questionTo - m.questionFrom + 1,
  }));

  return {
    slots,
    totalSec,
    specSec,
    disabledKinds: disabledMetas.map((m) => m.kind),
    durationSource,
  };
}

/**
 * 取某个板块所在槽位（找不到返回 null，用于 UI 判断该板块是否本期启用）。
 * 消费方请用这个而不是 `plan.slots.find(s => s.meta.kind === 'reading')` 之外的 kind 硬编码。
 */
export function findSlot(plan: SectionPlan, kind: ExamSectionKind): SectionSlot | null {
  return plan.slots.find((s) => s.meta.kind === kind) ?? null;
}
