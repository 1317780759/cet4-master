/**
 * TTS 提供者接口（可替换）—— 与服务层其它 Provider 同构（C3 思路）。
 *
 * 合规约束（B-7）：全站网络请求只允许指向**有道 TTS**；Web Speech API 走本机合成，
 * 无网络请求。`ttsProvider='off'` 时使用 NoopSpeechProvider，完全静音。
 */

export interface SpeakOptions {
  /** 英音 / 美音 */
  accent?: 'uk' | 'us';
  /** 语速 0.5–2，默认 1 */
  rate?: number;
}

export interface SpeechProvider {
  readonly id: string;
  /** 当前环境是否可用（如 Web Speech 在无 speechSynthesis 的环境不可用） */
  available(): boolean;
  /** 是否需要用户手势解锁（自动播放策略） */
  requiresGesture(): boolean;
  /** 朗读一段文本；失败时 reject，调用方据此降级 */
  speak(text: string, options?: SpeakOptions): Promise<void>;
  /** 立即停止当前朗读 */
  cancel(): void;
}
