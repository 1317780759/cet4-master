import type { PapersIndexFile } from './PaperSource';

/**
 * 减损措施④（docs/02 §3.6.5）—— 权利人提出异议时可**整站下线**内置卷。
 *
 * ★ 为什么单独成文件：这个开关平时永远不动，真到要用时是**有外部压力的一次性操作**，
 *   届时需要的是"一条命令 + 语义确定"，而不是翻代码现想。
 *   纯函数放这里（可单测），写盘放 `scripts/kill-switch.ts`（CLI）。
 */

/** 是否已下线 */
export function isKilled(index: PapersIndexFile | null | undefined): boolean {
  return index?.killSwitch?.disabled === true;
}

export interface KillSwitchPatch {
  disabled: boolean;
  reason?: string;
}

/**
 * 生成打上开关后的目录文件。
 *
 * ★ 只改开关，**不动 `papers` 列表**：
 *   下线是"停止分发"，不是"删除数据" —— 用户的本机进度与已缓存卷不受影响，
 *   将来解除开关能立刻恢复，不需要重新导入。
 */
export function applyKillSwitch(
  index: PapersIndexFile,
  patch: KillSwitchPatch,
): PapersIndexFile {
  const next: PapersIndexFile = {
    ...index,
    // 铁律 A6：音频缺失是常态，不随开关变化
    defaultMissingAudio: true,
    killSwitch: { disabled: patch.disabled },
  };
  if (patch.reason && patch.reason.trim() !== '') {
    next.killSwitch = { disabled: patch.disabled, reason: patch.reason.trim() };
  }
  return next;
}

/** 未设置开关的旧目录视为"未下线"（向后兼容，不为缺失字段而阻断） */
export function killSwitchReason(index: PapersIndexFile | null | undefined): string | undefined {
  return index?.killSwitch?.reason;
}
