import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  createSpeechProvider,
  isUnlocked,
  unlockOnFirstGesture,
  type SpeechProvider,
} from '@/services/speech';
import { useSettingsStore } from '@/store/useSettingsStore';

export interface UseTtsResult {
  /** 朗读一个单词（自动按设置的口音），失败静默降级 */
  speak: (text: string) => void;
  /** 停止朗读 */
  cancel: () => void;
  /** 语音是否启用（ttsProvider !== 'off'） */
  enabled: boolean;
  /** 当前 Provider 标识（调试 / 设置页展示） */
  providerId: string;
  /** 是否已通过用户手势解锁自动播放 */
  unlocked: () => boolean;
}

/**
 * TTS Hook —— 组合设置 + Provider + 手势解锁（方案 R4）。
 *
 * - 组件挂载时安装「首次任意手势解锁」监听
 * - 切换 ttsProvider 设置会重建 Provider
 * - `speak()` 内部标记已解锁（用户主动点击即视为手势）
 */
export function useTts(): UseTtsResult {
  const ttsProvider = useSettingsStore((s) => s.settings.ttsProvider);
  const accent = useSettingsStore((s) => s.settings.accent);

  const provider: SpeechProvider = useMemo(() => createSpeechProvider(ttsProvider), [ttsProvider]);
  const accentRef = useRef(accent);
  accentRef.current = accent;

  useEffect(() => {
    const cleanup = unlockOnFirstGesture();
    return cleanup;
  }, []);

  useEffect(() => {
    return (): void => provider.cancel();
  }, [provider]);

  const speak = useCallback(
    (text: string): void => {
      if (!text.trim()) return;
      void provider.speak(text, { accent: accentRef.current }).catch(() => undefined);
    },
    [provider],
  );

  const cancel = useCallback((): void => provider.cancel(), [provider]);

  return {
    speak,
    cancel,
    enabled: ttsProvider !== 'off',
    providerId: provider.id,
    unlocked: isUnlocked,
  };
}
