/** 日期工具 —— 统一使用本地时区的 'YYYY-MM-DD' 作为统计口径 */

/** epoch ms → 'YYYY-MM-DD'（本地时区） */
export function toDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' → 当天 00:00 的 epoch ms */
export function startOfDay(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
}

/** 两个 dateKey 之间相差的天数（b - a） */
export function diffDays(a: string, b: string): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);
}

/** 把 dateKey 往前/后推 n 天 */
export function addDays(dateKey: string, n: number): string {
  return toDateKey(startOfDay(dateKey) + n * 86_400_000);
}

/** epoch ms → 'HH:mm:ss' 或 'mm:ss' */
export function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = `${m}`.padStart(2, '0');
  const ss = `${s}`.padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 相对时间：'刚刚' / '3 分钟前' / '2 天前' */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const delta = now - ts;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  if (delta < 30 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`;
  return toDateKey(ts);
}
