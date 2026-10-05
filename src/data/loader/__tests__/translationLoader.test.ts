import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Cet4Database } from '@/data/db/db';
import { closeDatabase, openDatabase } from '@/data/db/migrations';
import {
  ensureTranslationsLoaded,
  META_TRANSLATIONS_VERSION,
  translationsVersion,
  type TranslationSourceLike,
} from '@/data/loader/translationLoader';
import { getMeta } from '@/data/repos/wordRepo';
import { countTranslations } from '@/data/repos/translationRepo';
import { putSecret } from '@/data/repos/secretRepo';
import type { TranslationItem, TranslationTopicKey } from '@/domain/translation/types';

/**
 * 翻译题库入库流程单测。
 *
 * 断言三件事：
 *   1. 版本一致 → 零写入（真正的「第二次访问零请求」）
 *   2. 版本变化 → 重灌，且**只**清 translations 单表
 *   3. 任何路径都不碰词库镜像 / 用户进度 / 秘钥区
 */

const NOW = 1_700_000_000_000;

function makeItem(id: string, topic: TranslationTopicKey): TranslationItem {
  return {
    id,
    topic,
    difficulty: 2,
    zh: `${id} 题干`,
    reference: `Reference of ${id}.`,
    keyPoints: [{ id: 'kp1', head: 'reference', zh: '参考' }],
    source: 'authored',
  };
}

interface FakeSource extends TranslationSourceLike {
  topicCalls: string[];
}

function makeSource(version: string): FakeSource {
  const source: FakeSource = {
    topicCalls: [],
    async loadIndex(): Promise<{ version: string; topics: Array<{ key: string; count: number }> }> {
      return {
        version,
        topics: [
          { key: 'trad-culture', count: 2 },
          { key: 'food', count: 1 },
        ],
      };
    },
    async loadTopic(topic: string): Promise<{ items: TranslationItem[] }> {
      source.topicCalls.push(topic);
      if (topic === 'trad-culture') {
        return {
          items: [makeItem('t_001', 'trad-culture'), makeItem('t_002', 'trad-culture')],
        };
      }
      return { items: [makeItem('t_003', 'food')] };
    },
  };
  return source;
}

function freshName(tag: string): string {
  return `cet4-loader-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

let db: Cet4Database;

beforeEach(async () => {
  db = createDb(freshName('translation'));
  await openDatabase(db);
});

afterEach(async () => {
  await closeDatabase(db);
  await db.delete();
});

describe('ensureTranslationsLoaded', () => {
  it('首次载入：逐话题灌库并写入版本 meta', async () => {
    const source = makeSource('2026.10.01');

    const result = await ensureTranslationsLoaded(source, db);

    expect(result.loaded).toBe(true);
    expect(result.count).toBe(3);
    expect(source.topicCalls).toEqual(['trad-culture', 'food']);
    expect(await countTranslations(db)).toBe(3);
    expect(await translationsVersion(db)).toBe('2026.10.01');
    expect(await getMeta<string>(META_TRANSLATIONS_VERSION, db)).toBe('2026.10.01');
  });

  it('★ 版本一致 → 跳过（loaded:false，且不拉取任何话题）', async () => {
    const first = makeSource('2026.10.01');
    await ensureTranslationsLoaded(first, db);

    const second = makeSource('2026.10.01');
    const result = await ensureTranslationsLoaded(second, db);

    expect(result.loaded).toBe(false);
    expect(result.count).toBe(3);
    expect(second.topicCalls).toEqual([]);
    expect(await countTranslations(db)).toBe(3);
  });

  it('★ 版本变化 → 重灌，且只清 translations 单表', async () => {
    await ensureTranslationsLoaded(makeSource('2026.10.01'), db);
    // 造点其它区的数据，确认它们不受影响
    await db.words.put({
      id: 'w_abandon',
      headword: 'abandon',
      variants: [],
      senses: [{ pos: 'unknown', zh: '放弃' }],
      freqRank: 1,
      freqCount: 99,
      tier: 'core2104',
      chunk: 1,
      sentenceCount: 0,
      source: 'test-source',
      license: 'CC BY-NC-SA 4.0',
    });
    await db.translationBook.add({
      itemId: 't_001',
      topic: 'trad-culture',
      addedAt: NOW,
      resolved: false,
    });
    await putSecret('llm.apiKey', 'sk-secret', db);

    const result = await ensureTranslationsLoaded(makeSource('2026.11.01'), db);

    expect(result.loaded).toBe(true);
    expect(result.count).toBe(3);
    expect(await translationsVersion(db)).toBe('2026.11.01');
    // 其它区分毫未动
    expect(await db.words.count()).toBe(1);
    expect(await db.translationBook.count()).toBe(1);
    expect(await db.secrets.count()).toBe(1);
  });

  it('重灌后旧条目不会残留（同 id 覆盖、被删的 id 消失）', async () => {
    await ensureTranslationsLoaded(makeSource('2026.10.01'), db);
    expect(await db.translations.get('t_003')).toBeDefined();

    const trimmed: TranslationSourceLike = {
      async loadIndex(): Promise<{ version: string; topics: Array<{ key: string; count: number }> }> {
        return { version: '2026.11.01', topics: [{ key: 'trad-culture', count: 1 }] };
      },
      async loadTopic(topic: string): Promise<{ items: TranslationItem[] }> {
        if (topic === 'trad-culture') return { items: [makeItem('t_001', 'trad-culture')] };
        return { items: [] };
      },
    };

    const result = await ensureTranslationsLoaded(trimmed, db);

    expect(result.count).toBe(1);
    expect(await countTranslations(db)).toBe(1);
    expect(await db.translations.get('t_001')).toBeDefined();
    expect(await db.translations.get('t_003')).toBeUndefined();
  });
});
