import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  isStudyOrder,
  mergeSettings,
} from '../types';

/**
 * 需求 3：出词顺序从布尔量 `freqOrdering` 升级为四档枚举 `studyOrder`。
 * 老用户升级不能丢设置 —— 这组用例就是那条防线。
 */
describe('domain/settings/types · 出词顺序迁移（v1 → v2）', () => {
  it('默认是「随机」—— 用户明确不要每次从头开始', () => {
    expect(DEFAULT_SETTINGS.studyOrder).toBe('random');
    expect(SETTINGS_SCHEMA_VERSION).toBe(2);
  });

  it('freqOrdering:true → 词频（还原老用户当初的选择）', () => {
    expect(mergeSettings({ freqOrdering: true }).studyOrder).toBe('freq');
  });

  it('freqOrdering:false → 随机', () => {
    expect(mergeSettings({ freqOrdering: false }).studyOrder).toBe('random');
  });

  it('全新用户（啥都没有）→ 默认随机', () => {
    expect(mergeSettings({}).studyOrder).toBe('random');
    expect(mergeSettings(null).studyOrder).toBe('random');
    expect(mergeSettings(undefined).studyOrder).toBe('random');
  });

  it('已落 studyOrder 的 v2 数据优先，不被 freqOrdering 覆盖', () => {
    expect(mergeSettings({ studyOrder: 'weak', freqOrdering: true }).studyOrder).toBe('weak');
  });

  it('脏数据兜底：非法 studyOrder 回落默认', () => {
    // @ts-expect-error 故意喂非法值，验证运行时兜底
    expect(mergeSettings({ studyOrder: 'nonsense' }).studyOrder).toBe('random');
    // @ts-expect-error 同上：同时带脏 studyOrder 与合法 freqOrdering，应回退到 freq
    expect(mergeSettings({ studyOrder: 'nonsense', freqOrdering: true }).studyOrder).toBe('freq');
  });

  it('freqOrdering 作为回滚影子字段被保留，不被抹掉', () => {
    const out = mergeSettings({ freqOrdering: true });
    expect(out.freqOrdering).toBe(true);
  });

  it('迁移幂等：迁移后的结果再迁移一次不变', () => {
    const once = mergeSettings({ freqOrdering: true });
    const twice = mergeSettings(once);
    expect(twice.studyOrder).toBe(once.studyOrder);
    expect(twice).toEqual(once);
  });

  it('schemaVersion 恒被抬到当前版本', () => {
    expect(mergeSettings({ schemaVersion: 1 }).schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });
});

describe('domain/settings/types · isStudyOrder', () => {
  it('四档合法值', () => {
    expect(isStudyOrder('random')).toBe(true);
    expect(isStudyOrder('freq')).toBe(true);
    expect(isStudyOrder('weak')).toBe(true);
    expect(isStudyOrder('wrong')).toBe(true);
  });

  it('其余一律不合法', () => {
    expect(isStudyOrder('Random')).toBe(false);
    expect(isStudyOrder('')).toBe(false);
    expect(isStudyOrder(undefined)).toBe(false);
    expect(isStudyOrder(null)).toBe(false);
    expect(isStudyOrder(0)).toBe(false);
  });
});
