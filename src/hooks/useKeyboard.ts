import { useEffect, useRef } from 'react';

/**
 * 单手键盘流（方案 R04）—— 桌面端快速背词。
 *
 * 键位（与 PRD 一致）：
 *   Space 翻卡 / 播放发音
 *   →     认识（Good+）
 *   ←     模糊（Hard）
 *   ↓     不认识（Again）
 *   Esc   返回
 */

export interface KeyboardHandlers {
  /** Space：翻卡（显示释义）或再次播放 */
  onReveal?: () => void;
  /** →：认识 */
  onKnown?: () => void;
  /** ←：模糊 */
  onFuzzy?: () => void;
  /** ↓：不认识 */
  onUnknown?: () => void;
  /** Esc：返回 */
  onBack?: () => void;
  /** 是否启用（默认 true）。会话结束 / 输入框聚焦时可关闭 */
  enabled?: boolean;
  /** 是否拦截默认行为（防止 Space/方向键滚动页面），默认 true */
  preventDefault?: boolean;
}

/** 判断事件源是否为可输入元素（避免在输入框里按 Space 被吃掉） */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

/**
 * 绑定键盘事件。
 * 通过 ref 持有最新 handlers，避免每次渲染重绑（也避免闭包过期）。
 */
export function useKeyboard(handlers: KeyboardHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  const enabled = handlers.enabled ?? true;
  const preventDefault = handlers.preventDefault ?? true;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const current = ref.current;
      if (isEditable(event.target)) return;

      switch (event.key) {
        case ' ':
        case 'Spacebar':
          if (current.onReveal) {
            if (preventDefault) event.preventDefault();
            current.onReveal();
          }
          break;
        case 'ArrowRight':
          if (current.onKnown) {
            if (preventDefault) event.preventDefault();
            current.onKnown();
          }
          break;
        case 'ArrowLeft':
          if (current.onFuzzy) {
            if (preventDefault) event.preventDefault();
            current.onFuzzy();
          }
          break;
        case 'ArrowDown':
          if (current.onUnknown) {
            if (preventDefault) event.preventDefault();
            current.onUnknown();
          }
          break;
        case 'Escape':
          current.onBack?.();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, preventDefault]);
}
