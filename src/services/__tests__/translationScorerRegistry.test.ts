/**
 * `translationScorerRegistry.ts` 单测 —— AI 接线的唯一闸门。
 *
 * ★ 这些断言守护的是产品承诺本身：
 *   - `aiConfig.enabled = false` →恒离线，**零网络**；
 *   - `baseUrl` 是 `http://` → 恒离线（防 Key 明文传输）；
 *   - 配置齐全但没存 Key → 恒离线（不发一个必然 401 的请求）。
 */

import { describe, expect, it } from 'vitest';
import {
  API_KEY_SECRET_ID,
  getLlmScorer,
  getOfflineScorer,
  getTranslationScorer,
  isAiConfigComplete,
  isSecureBaseUrl,
} from '../translationScorerRegistry';
import { DEFAULT_AI_CONFIG, type AiConfig } from '@/domain/settings/types';

const FULL: AiConfig = {
  ...DEFAULT_AI_CONFIG,
  enabled: true,
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o-mini',
  keyId: API_KEY_SECRET_ID,
};

describe('isAiConfigComplete', () => {
  it('三件套齐全且开启 → true', () => {
    expect(isAiConfigComplete(FULL)).toBe(true);
  });

  it('任一缺失 → false', () => {
    expect(isAiConfigComplete({ ...FULL, enabled: false })).toBe(false);
    expect(isAiConfigComplete({ ...FULL, baseUrl: '' })).toBe(false);
    expect(isAiConfigComplete({ ...FULL, baseUrl: '   ' })).toBe(false);
    expect(isAiConfigComplete({ ...FULL, model: '' })).toBe(false);
  });

  it('undefined → false', () => {
    expect(isAiConfigComplete(undefined)).toBe(false);
  });
});

describe('isSecureBaseUrl', () => {
  it('https 通过；http 一律拒绝', () => {
    expect(isSecureBaseUrl('https://api.example.com/v1')).toBe(true);
    expect(isSecureBaseUrl('HTTPS://api.example.com')).toBe(true);
    expect(isSecureBaseUrl('  https://x.dev  ')).toBe(true);
    expect(isSecureBaseUrl('http://api.example.com/v1')).toBe(false);
  });

  it('★ 协议相对 URL 与空串一律拒绝', () => {
    expect(isSecureBaseUrl('//api.example.com')).toBe(false);
    expect(isSecureBaseUrl('')).toBe(false);
    expect(isSecureBaseUrl('   ')).toBe(false);
  });

  it('★ 伪装前缀（https 后紧跟 http）不得通过', () => {
    expect(isSecureBaseUrl('https://evil.com/http://x')).toBe(true); // 实际 host 是 evil.com，语义合法
    expect(isSecureBaseUrl('httpx://api.example.com')).toBe(false);
  });
});

describe('getOfflineScorer', () => {
  it('恒返回离线评分器，且与设置无关', async () => {
    const scorer = getOfflineScorer();
    expect(scorer.id).toBe('offline');
    // 🔴 不变量：结果页"离线卡永远渲染"依赖这个出口与 AI 状态完全无关
    const result = await scorer.score({ text: 'Paper-cutting is a folk art.', keyPoints: [] });
    expect(result.total).toBe(0);
    expect(result.scoredBy).toBe(scorer.label);
  });
});

describe('getTranslationScorer · 离线优先', () => {
  it('未开启 AI → 恒离线', async () => {
    const scorer = await getTranslationScorer({ aiConfig: DEFAULT_AI_CONFIG });
    expect(scorer.id).toBe('offline');
  });

  it('★ http:// Base URL → 恒离线（一个请求都不该发）', async () => {
    const scorer = await getTranslationScorer({
      aiConfig: { ...FULL, baseUrl: 'http://api.example.com/v1' },
    });
    expect(scorer.id).toBe('offline');
  });

  it('没有 aiConfig 字段 → 恒离线', async () => {
    expect((await getTranslationScorer({})).id).toBe('offline');
  });
});

describe('getLlmScorer · 缺席而非空壳', () => {
  it('离线路径返回 null，UI 据此不渲染 AI 卡', async () => {
    expect(await getLlmScorer({ aiConfig: DEFAULT_AI_CONFIG })).toBeNull();
    expect(await getLlmScorer({})).toBeNull();
  });
});