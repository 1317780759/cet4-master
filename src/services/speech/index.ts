import type { SpeakOptions, SpeechProvider } from './SpeechProvider';
import { WebSpeechSpeechProvider } from './WebSpeechProvider';
import { YoudaoSpeechProvider } from './YoudaoProvider';

export type { SpeakOptions, SpeechProvider } from './SpeechProvider';
export { unlockOnFirstGesture, isUnlocked, markUnlocked, resetUnlock } from './unlock';
export { youdaoUrl, YoudaoSpeechProvider, YOUDAO_BASE_URL } from './YoudaoProvider';
export { WebSpeechSpeechProvider } from './WebSpeechProvider';

/** 完全关闭时的空实现（ttsProvider='off'） */
export class NoopSpeechProvider implements SpeechProvider {
  readonly id = 'off';

  available(): boolean {
    return true;
  }

  requiresGesture(): boolean {
    return false;
  }

  speak(): Promise<void> {
    return Promise.resolve();
  }

  cancel(): void {
    // 无操作
  }
}

/**
 * 链式 Provider：按顺序尝试，前一个失败自动降级到下一个（方案 R4）。
 * 有道的 403 / 限流 / 无手势被拒 → 落到 Web Speech。
 */
export class FallbackSpeechProvider implements SpeechProvider {
  readonly id: string;

  private readonly chain: SpeechProvider[];

  constructor(providers: readonly SpeechProvider[]) {
    this.chain = providers.filter((p) => p.available());
    this.id = this.chain.map((p) => p.id).join('+') || 'off';
  }

  available(): boolean {
    return this.chain.length > 0;
  }

  requiresGesture(): boolean {
    return this.chain.some((p) => p.requiresGesture());
  }

  async speak(text: string, options?: SpeakOptions): Promise<void> {
    let lastError: unknown = null;
    for (const provider of this.chain) {
      try {
        await provider.speak(text, options);
        return;
      } catch (error: unknown) {
        lastError = error;
      }
    }
    if (lastError) throw lastError instanceof Error ? lastError : new Error('所有 TTS 提供者均失败');
  }

  cancel(): void {
    for (const provider of this.chain) provider.cancel();
  }
}

/**
 * 依据设置创建语音提供者。
 * - 'off'        → Noop（完全静音，零网络）
 * - 'webspeech'  → 仅本机合成
 * - 'youdao'     → 有道优先，失败降级 Web Speech
 */
export function createSpeechProvider(
  preference: 'youdao' | 'webspeech' | 'off',
): SpeechProvider {
  if (preference === 'off') return new NoopSpeechProvider();
  if (preference === 'webspeech') return new FallbackSpeechProvider([new WebSpeechSpeechProvider()]);
  return new FallbackSpeechProvider([new YoudaoSpeechProvider(), new WebSpeechSpeechProvider()]);
}
