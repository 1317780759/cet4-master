import type { SpeakOptions, SpeechProvider } from './SpeechProvider';

/**
 * 有道 TTS 提供者 —— 全站唯一允许的外部网络请求（合规 B-7）。
 *
 * 接口：`https://dict.youdao.com/dictvoice?audio=<word>&type=1|2`
 *   type=1 英音（UK） / type=2 美音（US）
 *
 * 失败（403 / 限流 / 网络异常）时 reject，由 FallbackSpeechProvider 降级到 Web Speech。
 */

export const YOUDAO_BASE_URL = 'https://dict.youdao.com/dictvoice';

/** 构造有道 TTS URL（纯函数，可单测） */
export function youdaoUrl(text: string, accent: 'uk' | 'us' = 'us'): string {
  const type = accent === 'uk' ? 1 : 2;
  return `${YOUDAO_BASE_URL}?audio=${encodeURIComponent(text)}&type=${type}`;
}

export class YoudaoSpeechProvider implements SpeechProvider {
  readonly id = 'youdao';

  private audio: HTMLAudioElement | null = null;

  available(): boolean {
    return typeof Audio !== 'undefined';
  }

  requiresGesture(): boolean {
    return true;
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const word = text.trim();
    if (!word) return Promise.resolve();
    if (!this.available()) return Promise.reject(new Error('当前环境不支持 HTMLAudio'));

    this.cancel();
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio(youdaoUrl(word, options.accent ?? 'us'));
      this.audio = audio;
      const cleanup = (): void => {
        audio.onended = null;
        audio.onerror = null;
        if (this.audio === audio) this.audio = null;
      };
      audio.onended = (): void => {
        cleanup();
        resolve();
      };
      audio.onerror = (): void => {
        cleanup();
        reject(new Error(`有道 TTS 播放失败：${word}`));
      };
      audio.play().catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error('播放被拒绝'));
      });
    });
  }

  cancel(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
  }
}
