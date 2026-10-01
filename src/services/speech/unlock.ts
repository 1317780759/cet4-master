/**
 * 浏览器自动播放手势解锁 —— 方案 R4。
 *
 * 背景：无用户手势时 `audio.play()` 抛 `NotAllowedError`。
 * 策略：首次任意点击 / 触摸 / 按键时，**静音播放一次**以解锁音频通道，
 * 之后程序化播放（如翻卡自动发音）才不会被拦。
 */

let unlocked = false;

/** 是否已解锁 */
export function isUnlocked(): boolean {
  return unlocked;
}

/** 手动标记已解锁（测试 / 已在某手势内播放成功时调用） */
export function markUnlocked(): void {
  unlocked = true;
}

/** 重置（仅测试用） */
export function resetUnlock(): void {
  unlocked = false;
}

/**
 * 极短的静音 WAV（44 字节头 + 0 采样），用于手势内解锁音频通道。
 * 纯本地 data URI，不产生任何网络请求。
 */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

/**
 * 在首次任意手势时静音播放一次以解锁。
 * 返回清理函数（组件卸载时调用）。
 */
export function unlockOnFirstGesture(): () => void {
  if (typeof window === 'undefined') return (): void => undefined;
  if (unlocked) return (): void => undefined;

  const handler = (): void => {
    markUnlocked();
    try {
      const audio = new Audio(SILENT_WAV);
      audio.volume = 0;
      void audio.play().catch(() => undefined);
    } catch {
      // 环境不支持音频：静默忽略，语音走 Web Speech 降级
    }
    cleanup();
  };

  const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'keydown'];
  const cleanup = (): void => {
    for (const name of events) window.removeEventListener(name, handler);
  };
  for (const name of events) window.addEventListener(name, handler, { passive: true });

  return cleanup;
}
