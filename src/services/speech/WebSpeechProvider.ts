import type { SpeakOptions, SpeechProvider } from './SpeechProvider';

/**
 * Web Speech API 提供者 —— 有道 TTS 失败时的**本机降级**方案（方案 R4）。
 * 走浏览器内置语音合成，无任何网络请求。
 */

interface SpeechSynthesisLike {
  speak: (utterance: SpeechSynthesisUtterance) => void;
  cancel: () => void;
  getVoices?: () => SpeechSynthesisVoice[];
}

function synth(): SpeechSynthesisLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { speechSynthesis?: SpeechSynthesisLike };
  return w.speechSynthesis ?? null;
}

export class WebSpeechSpeechProvider implements SpeechProvider {
  readonly id = 'webspeech';

  available(): boolean {
    return typeof SpeechSynthesisUtterance !== 'undefined' && synth() !== null;
  }

  requiresGesture(): boolean {
    return false;
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const word = text.trim();
    if (!word) return Promise.resolve();
    const engine = synth();
    if (!engine || typeof SpeechSynthesisUtterance === 'undefined') {
      return Promise.reject(new Error('当前环境不支持 Web Speech API'));
    }

    engine.cancel();
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = options.accent === 'uk' ? 'en-GB' : 'en-US';
      utterance.rate = options.rate ?? 1;
      utterance.onend = (): void => resolve();
      utterance.onerror = (): void => reject(new Error(`Web Speech 合成失败：${word}`));
      try {
        engine.speak(utterance);
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('Web Speech 调用失败'));
      }
    });
  }

  cancel(): void {
    synth()?.cancel();
  }
}
