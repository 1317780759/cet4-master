import { describe, expect, it } from 'vitest';
import type { PapersIndexFile } from '@/data/sources/PaperSource';
import { applyKillSwitch, isKilled, killSwitchReason } from '@/data/sources/killSwitch';

/** 减损措施④ 的语义锁定（T-M2-05） */

const INDEX: PapersIndexFile = {
  defaultMissingAudio: true,
  papers: [
    {
      id: 'p1',
      year: 2026,
      month: 6,
      setNo: 1,
      provenance: 'derived',
      provenanceLabel: '同源模拟卷',
      questionCount: 12,
      hasAudio: false,
      confidenceLevel: 'medium',
    },
  ],
  killSwitch: { disabled: false },
};

describe('isKilled', () => {
  it('未设置开关 → 视为未下线（向后兼容，不为缺字段而阻断）', () => {
    expect(isKilled({ defaultMissingAudio: true, papers: [] })).toBe(false);
    expect(isKilled(null)).toBe(false);
  });

  it('disabled=true → 已下线', () => {
    expect(isKilled(applyKillSwitch(INDEX, { disabled: true }))).toBe(true);
  });
});

describe('applyKillSwitch', () => {
  it('★ 只改开关，不动 papers 列表 —— 下线是停止分发，不是删数据', () => {
    const next = applyKillSwitch(INDEX, { disabled: true, reason: '权利人提出异议' });
    expect(next.papers).toEqual(INDEX.papers);
    expect(next.killSwitch?.disabled).toBe(true);
    expect(killSwitchReason(next)).toBe('权利人提出异议');
  });

  it('解除下线：disabled=false 且清空 reason（不留陈旧理由误导用户）', () => {
    const killed = applyKillSwitch(INDEX, { disabled: true, reason: '权利人提出异议' });
    const restored = applyKillSwitch(killed, { disabled: false });
    expect(isKilled(restored)).toBe(false);
    expect(killSwitchReason(restored)).toBeUndefined();
  });

  it('空白 reason 不写入（避免出现只有空白的说明框）', () => {
    const next = applyKillSwitch(INDEX, { disabled: true, reason: '   ' });
    expect(killSwitchReason(next)).toBeUndefined();
  });

  it('不改入参（返回新对象）', () => {
    applyKillSwitch(INDEX, { disabled: true });
    expect(INDEX.killSwitch?.disabled).toBe(false);
  });
});
