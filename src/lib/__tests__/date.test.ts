import { describe, expect, it } from 'vitest';
import { formatCountdown } from '@/lib/date';

/**
 * formatCountdown 边界测试（G：倒计时文案 unit-aware）。
 * < 1 分钟按秒向上取整；≥ 1 分钟按分钟四舍五入。
 */
describe('formatCountdown', () => {
  it('0 → 0 秒', () => {
    expect(formatCountdown(0)).toBe('0 秒');
  });

  it('1ms → 1 秒（向上取整）', () => {
    expect(formatCountdown(1)).toBe('1 秒');
  });

  it('59_999ms → 60 秒（临界仍按秒）', () => {
    expect(formatCountdown(59_999)).toBe('60 秒');
  });

  it('60_000ms → 1 分钟（切换为分钟）', () => {
    expect(formatCountdown(60_000)).toBe('1 分钟');
  });

  it('600_000ms → 10 分钟（成熟卡 Again 落点）', () => {
    expect(formatCountdown(600_000)).toBe('10 分钟');
  });

  it('负数 → 0 秒（钳制）', () => {
    expect(formatCountdown(-500)).toBe('0 秒');
  });
});
