import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranslationItem, TranslationTopicKey } from '@/domain/translation/types';
import {
  StaticJsonTranslationSource,
  assertTranslationTopicKey,
} from '@/data/sources/StaticJsonTranslationSource';
import { TRANSLATIONS_INDEX_FILE, translationsTopicFile } from '@/data/sources/TranslationSource';

/**
 * 翻译数据 Source 单测。
 *
 * ★ 用 `vi.stubGlobal('fetch')` 替换全局 fetch —— 数据层是**全站唯一**允许发请求的地方，
 *   所以这里拦在 fetch 这一层最贴近真实：连 `fetchJson` 的超时/错误归一化一起覆盖。
 */

const BASE = '/data/';

function item(overrides: Partial<TranslationItem> = {}): TranslationItem {
  return {
    id: 't_000001',
    topic: 'tech',
    difficulty: 2,
    zh: '中国在高铁技术领域取得了世界瞩目的成就。',
    reference: 'China has made world-renowned achievements in the field of high-speed rail technology.',
    keyPoints: [
      { id: 'kp1', head: 'high-speed rail', zh: '高铁', weight: 2 },
      { id: 'kp2', head: 'has made', zh: '取得了', weight: 2 },
      { id: 'kp3', head: 'achievements', zh: '成就', weight: 1 },
    ],
    hints: ['得分点：高铁 / 取得了 / 成就'],
    source: 'authored',
    ...overrides,
  };
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

/** 按 URL 路由返回 JSON，并记录每次请求的 URL */
function stubFetch(routes: Record<string, unknown>): { calls: string[] } {
  const calls: string[] = [];
  const fn = vi.fn(async (input: string) => {
    const url = String(input);
    calls.push(url);
    if (!(url in routes)) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    return jsonResponse(routes[url]);
  });
  vi.stubGlobal('fetch', fn);
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StaticJsonTranslationSource · 目录', () => {
  it('解析 index.json 的话题目录', async () => {
    const index = {
      version: '1',
      topics: [
        { key: 'tech', label: '科技成就', count: 20 },
        { key: 'food', label: '饮食文化', count: 20 },
      ],
    };
    const { calls } = stubFetch({ [`/data/${TRANSLATIONS_INDEX_FILE}`]: index });

    const source = new StaticJsonTranslationSource(BASE);
    const got = await source.loadIndex();

    expect(got.version).toBe('1');
    expect(got.topics).toHaveLength(2);
    expect(got.topics[0]?.key).toBe('tech');
    expect(got.topics[1]).toEqual({ key: 'food', label: '饮食文化', count: 20 });
    expect(calls).toEqual(['/data/translations/index.json']);
  });

  it('★ baseUrl 缺尾斜杠时自动补上（子路径部署不得拼出 /datatranslations/…）', async () => {
    const { calls } = stubFetch({ '/data/translations/index.json': { version: '1', topics: [] } });

    const source = new StaticJsonTranslationSource('/data');
    await source.loadIndex();

    expect(calls).toEqual(['/data/translations/index.json']);
  });
});

describe('StaticJsonTranslationSource · 按话题加载', () => {
  it('加载话题产物并返回句子', async () => {
    const topicFile = { topic: 'tech', label: '科技成就', items: [item()] };
    const { calls } = stubFetch({ [`/data/${translationsTopicFile('tech')}`]: topicFile });

    const source = new StaticJsonTranslationSource(BASE);
    const got = await source.loadTopic('tech');

    expect(got.topic).toBe('tech');
    expect(got.label).toBe('科技成就');
    expect(got.items).toHaveLength(1);
    expect(got.items[0]?.id).toBe('t_000001');
    expect(calls).toEqual(['/data/translations/tech.json']);
  });

  it('★ 同一话题第二次调用命中缓存，不再发请求', async () => {
    const topicFile = { topic: 'tech', label: '科技成就', items: [item()] };
    const { calls } = stubFetch({ '/data/translations/tech.json': topicFile });

    const source = new StaticJsonTranslationSource(BASE);
    const first = await source.loadTopic('tech');
    const second = await source.loadTopic('tech');

    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it('★ 不同话题各自缓存，互不影响', async () => {
    const { calls } = stubFetch({
      '/data/translations/tech.json': { topic: 'tech', label: '科技成就', items: [item()] },
      '/data/translations/food.json': {
        topic: 'food',
        label: '饮食文化',
        items: [item({ id: 't_000002', topic: 'food' })],
      },
    });

    const source = new StaticJsonTranslationSource(BASE);
    await source.loadTopic('tech');
    await source.loadTopic('food');
    await source.loadTopic('tech');

    expect(calls).toEqual(['/data/translations/tech.json', '/data/translations/food.json']);
  });

  it('clearCache 后重新发请求', async () => {
    const { calls } = stubFetch({
      '/data/translations/tech.json': { topic: 'tech', label: '科技成就', items: [item()] },
    });

    const source = new StaticJsonTranslationSource(BASE);
    await source.loadTopic('tech');
    source.clearCache();
    await source.loadTopic('tech');

    expect(calls).toHaveLength(2);
  });

  it('产物缺失 items → 明确指出文件与字段', async () => {
    stubFetch({ '/data/translations/tech.json': { topic: 'tech', label: '科技成就' } });

    const source = new StaticJsonTranslationSource(BASE);
    await expect(source.loadTopic('tech')).rejects.toThrow(/items/);
  });
});

describe('StaticJsonTranslationSource · 非法 topic', () => {
  it('★ 未知话题 key → 拒绝并列出合法取值，且绝不发请求', async () => {
    const { calls } = stubFetch({});

    const source = new StaticJsonTranslationSource(BASE);
    await expect(source.loadTopic('techs' as TranslationTopicKey)).rejects.toThrow(/非法的话题 key/);
    await expect(source.loadTopic('techs' as TranslationTopicKey)).rejects.toThrow(/trad-culture/);
    expect(calls).toEqual([]);
  });

  it('★ 路径穿越型 topic 不得拼出越界 URL', async () => {
    const { calls } = stubFetch({});

    const source = new StaticJsonTranslationSource(BASE);
    await expect(source.loadTopic('../../manifest' as TranslationTopicKey)).rejects.toThrow(
      /非法的话题 key/,
    );
    expect(calls).toEqual([]);
  });

  it('assertTranslationTopicKey：合法 key 通过，非法 key 抛错', () => {
    expect(() => assertTranslationTopicKey('trad-culture')).not.toThrow();
    expect(() => assertTranslationTopicKey('')).toThrow(/非法的话题 key/);
  });
});
