import { describe, expect, it } from 'vitest';
import { SECRET_FIELD_PATHS, containsSecretText, maskedKeyLabel, stripSecrets } from '@/domain/settings/secrets';

/** 造一份长得像 ProgressDump 的假数据 */
function makeDump(): Record<string, unknown[]> {
  return {
    cards: [{ wordId: 'w1', due: 1 }],
    // 模拟「有人误把明文 Key 塞进了设置行」——这是 stripSecrets 要拦住的场景
    meta: [
      {
        key: 'settings',
        value: {
          dailyGoal: 20,
          aiConfig: { enabled: true, baseUrl: 'https://api.example.com/v1', apiKey: 'sk-live-REDACTED-TEST' },
        },
      },
    ],
    vocabBook: [{ wordId: 'w2', apiKey: 'sk-top-level-SECRET' }],
  };
}

describe('domain/settings/secrets', () => {
  it('剥掉嵌套的 aiConfig.apiKey', () => {
    const out = stripSecrets(makeDump());
    const row = (out.meta as Array<{ value: Record<string, unknown> }>)[0];
    const aiConfig = row?.value.aiConfig as Record<string, unknown> | undefined;
    expect(aiConfig?.apiKey).toBeUndefined();
    // 其余字段必须原样保留 —— 剥离不能误伤
    expect(aiConfig?.baseUrl).toBe('https://api.example.com/v1');
    expect(row?.value.dailyGoal).toBe(20);
  });

  it('剥掉行顶层的裸 apiKey', () => {
    const out = stripSecrets(makeDump());
    expect((out.vocabBook as Array<Record<string, unknown>>)[0]?.apiKey).toBeUndefined();
    expect((out.vocabBook as Array<Record<string, unknown>>)[0]?.wordId).toBe('w2');
  });

  it('不改原对象（纯函数）', () => {
    const dump = makeDump();
    stripSecrets(dump);
    const row = (dump.meta as Array<{ value: { aiConfig: Record<string, unknown> } }>)[0];
    expect(row?.value.aiConfig.apiKey).toBe('sk-live-REDACTED-TEST');
  });

  it('序列化后的文本里不含密钥明文', () => {
    const text = JSON.stringify(stripSecrets(makeDump()));
    expect(containsSecretText(text, 'sk-live-REDACTED-TEST')).toBe(false);
    expect(containsSecretText(text, 'sk-top-level-SECRET')).toBe(false);
  });

  it('剥离前确实含明文（防止断言写成永真）', () => {
    const text = JSON.stringify(makeDump());
    expect(containsSecretText(text, 'sk-live-REDACTED-TEST')).toBe(true);
  });

  it('空 secret 一律返回 false', () => {
    expect(containsSecretText('anything', '')).toBe(false);
  });

  it('脏数据（null / 原始值 / 数组）不抛异常', () => {
    expect(stripSecrets(null)).toBeNull();
    expect(stripSecrets(42)).toBe(42);
    expect(stripSecrets('x')).toBe('x');
    expect(stripSecrets([{ apiKey: 'sk-a' }])).toEqual([{}]);
  });

  it('路径中间层不是对象时静默跳过，不崩', () => {
    const out = stripSecrets({ rows: [{ aiConfig: 'not-an-object' }] }) as {
      rows: Array<{ aiConfig: string }>;
    };
    expect(out.rows[0]?.aiConfig).toBe('not-an-object');
  });

  it('SECRET_FIELD_PATHS 覆盖两条兜底路径', () => {
    expect(SECRET_FIELD_PATHS).toContain('aiConfig.apiKey');
    expect(SECRET_FIELD_PATHS).toContain('apiKey');
  });
});

describe('domain/settings/secrets · maskedKeyLabel', () => {
  it('只显示尾部 4 位，绝不回显明文', () => {
    const label = maskedKeyLabel('sk-live-ABCDEF3f2a');
    expect(label).toBe('已保存（••••3f2a）');
    // 🔴 核心不变量：整串明文一个子串都不许出现
    expect(label).not.toContain('sk-live');
    expect(label).not.toContain('ABCDEF');
  });

  it('短于尾长时不显示任何字符（宁可不显示也不泄露）', () => {
    const label = maskedKeyLabel('abc');
    expect(label).toBe('已保存（••••••••）');
    expect(label).not.toContain('abc');
  });

  it('未保存（null / undefined / 空串 / 非字符串）统一给「未保存」', () => {
    expect(maskedKeyLabel(null)).toBe('未保存');
    expect(maskedKeyLabel(undefined)).toBe('未保存');
    expect(maskedKeyLabel('')).toBe('未保存');
    expect(maskedKeyLabel(42 as unknown as string)).toBe('未保存');
  });
});
