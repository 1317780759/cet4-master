import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import {
  createDb,
  DB_SCHEMA,
  DB_SCHEMA_V2,
  MIRROR_STORES,
  PROGRESS_STORES,
  SECRET_STORES,
  SYSTEM_STORES,
  type Cet4Database,
} from '../db';
import { closeDatabase, openDatabase, verifySchema } from '../migrations';
import { clearMirror } from '@/data/repos/wordRepo';
import { clearTranslations, mirrorTranslations } from '@/data/repos/translationRepo';
import { getSecret, putSecret } from '@/data/repos/secretRepo';
import type { TranslationItem, TranslationTopicKey } from '@/domain/translation/types';
import type { Word } from '@/domain/word/types';

/**
 * v2 schema（翻译训练 + 秘钥区）的迁移与分区隔离测试。
 *
 * 核心不变量（任何后续改动都不得破坏）：
 *   1. SECRET_STORES 与 MIRROR / PROGRESS / SYSTEM 三区**严格不相交**
 *   2. 清镜像/清翻译镜像时，进度区与秘钥区的行数**一分不少**
 *   3. v1 → v2 升级不丢任何既有数据
 * fake-indexeddb 由 tests/setup.ts 全局注入。
 */

const NOW = 1_700_000_000_000;

function makeWord(id: string, freqRank = 1): Word {
  return {
    id,
    headword: id.replace(/^w_/, ''),
    variants: [],
    senses: [{ pos: 'unknown', zh: '测试' }],
    freqRank,
    freqCount: 100 - freqRank,
    tier: 'core2104',
    chunk: 1,
    sentenceCount: 0,
    source: 'test-source',
    license: 'CC BY-NC-SA 4.0',
  };
}

function makeItem(id: string, topic: TranslationTopicKey): TranslationItem {
  return {
    id,
    topic,
    difficulty: 2,
    zh: '剪纸是中国传统的民间艺术。',
    reference: 'Paper-cutting is a traditional Chinese folk art.',
    keyPoints: [
      { id: 'kp1', head: 'paper-cutting', zh: '剪纸' },
      { id: 'kp2', head: 'traditional', zh: '传统的' },
      { id: 'kp3', head: 'folk art', zh: '民间艺术' },
    ],
    source: 'authored',
  };
}

function freshName(prefix: string): string {
  return `cet4-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 两个只读分区的交集 */
function overlap(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b);
  return [...a].filter((name) => set.has(name));
}

let db: Cet4Database;

beforeEach(async () => {
  db = createDb(freshName('trans'));
  await openDatabase(db);
});

afterEach(async () => {
  await closeDatabase(db);
  await db.delete();
});

describe('v2 分区不变量', () => {
  it('★ SECRET_STORES 与 MIRROR / PROGRESS / SYSTEM 三区严格不相交', () => {
    expect(overlap(SECRET_STORES, PROGRESS_STORES)).toEqual([]);
    expect(overlap(SECRET_STORES, MIRROR_STORES)).toEqual([]);
    expect(overlap(SECRET_STORES, SYSTEM_STORES)).toEqual([]);
  });

  it('新表各归其位：translations→镜像 / translationBook→进度 / secrets→秘钥', () => {
    expect(MIRROR_STORES).toContain('translations');
    expect(PROGRESS_STORES).toContain('translationBook');
    expect(SECRET_STORES).toEqual(['secrets']);

    // 反向：秘钥绝不能出现在会被清 / 会被导出的两个区里
    expect(MIRROR_STORES).not.toContain('secrets');
    expect(PROGRESS_STORES).not.toContain('secrets');
    expect(MIRROR_STORES).not.toContain('translationBook');
    expect(PROGRESS_STORES).not.toContain('translations');
    expect(SYSTEM_STORES).not.toContain('secrets');
  });

  it('v2 增量 schema 只声明新增的三张表，v1 基线仍为 16 张', () => {
    expect(Object.keys(DB_SCHEMA)).toHaveLength(16);
    expect(Object.keys(DB_SCHEMA_V2)).toEqual(['translations', 'translationBook', 'secrets']);
    expect(Object.keys(DB_SCHEMA)).not.toContain('secrets');
    expect(Object.keys(DB_SCHEMA)).not.toContain('translations');
  });

  it('启动自检覆盖四区（含 secrets）', async () => {
    const check = await verifySchema(db);
    expect(check.ok).toBe(true);
    expect(check.missing).toEqual([]);
    expect(check.stores).toContain('translations');
    expect(check.stores).toContain('translationBook');
    expect(check.stores).toContain('secrets');
  });
});

describe('清理范围隔离', () => {
  it('★ 走「清镜像」路径后，secrets 表行数不变且明文仍可读', async () => {
    await db.words.put(makeWord('w_abandon'));
    await db.translations.put(makeItem('t_001', 'trad-culture'));
    await putSecret('llm.apiKey', 'sk-secret-value', db);

    await clearMirror(db);

    expect(await db.words.count()).toBe(0);
    expect(await db.translations.count()).toBe(0);
    expect(await db.secrets.count()).toBe(1);
    expect(await getSecret('llm.apiKey', db)).toBe('sk-secret-value');
  });

  it('★ 清镜像不碰用户进度区（错句本按进度区对待）', async () => {
    await db.words.put(makeWord('w_abandon'));
    await db.translations.put(makeItem('t_001', 'trad-culture'));
    await db.translationBook.add({
      itemId: 't_001',
      topic: 'trad-culture',
      addedAt: NOW,
      resolved: false,
    });
    await db.vocabBook.add({ wordId: 'w_abandon', addedAt: NOW, promoted: false });

    await clearMirror(db);

    expect(await db.translationBook.count()).toBe(1);
    expect(await db.vocabBook.count()).toBe(1);
  });

  it('★ 清翻译镜像只清 translations 单表：words 数据不变', async () => {
    await db.words.put(makeWord('w_abandon'));
    await db.words.put(makeWord('w_ability'));
    await mirrorTranslations(
      [makeItem('t_001', 'trad-culture'), makeItem('t_002', 'food')],
      db,
    );

    await clearTranslations(db);

    expect(await db.translations.count()).toBe(0);
    expect(await db.words.count()).toBe(2);
    expect(await db.words.get('w_abandon')).toMatchObject({ headword: 'abandon' });
  });
});

describe('v1 → v2 升级', () => {
  it('★ 升级后既有进度数据（cards / wrongBook / vocabBook）一行不少', async () => {
    const name = freshName('upgrade');

    // 1) 用「只有 v1 schema」的 Dexie 造一份 v1 老库
    const legacy = new Dexie(name);
    legacy.version(1).stores(DB_SCHEMA);
    await legacy.open();
    await legacy.table('cards').put({
      wordId: 'w_abandon',
      due: NOW,
      stability: 3,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 3,
      reps: 4,
      lapses: 1,
      state: 2,
      suspended: false,
      createdAt: NOW - 86_400_000,
      introsRank: 12,
    });
    await legacy.table('wrongBook').add({
      wordId: 'w_abandon',
      source: 'quiz',
      wrongCount: 2,
      firstWrongAt: NOW - 1000,
      lastWrongAt: NOW,
      enqueued: true,
      nextDue: NOW + 1000,
      resolved: false,
    });
    await legacy.table('vocabBook').add({ wordId: 'w_abandon', addedAt: NOW, promoted: false });
    await legacy.table('words').put(makeWord('w_abandon'));
    await legacy.table('meta').put({ key: 'dataVersion', value: '2026.10.01' });
    legacy.close();

    // 2) 用 v2 的 Cet4Database 打开同一个库名 → 触发升级
    const upgraded = createDb(name);
    await openDatabase(upgraded);

    expect(upgraded.verno).toBe(2);
    expect(await upgraded.cards.count()).toBe(1);
    expect(await upgraded.cards.get('w_abandon')).toMatchObject({ reps: 4, introsRank: 12 });
    expect(await upgraded.wrongBook.count()).toBe(1);
    expect(await upgraded.vocabBook.count()).toBe(1);
    expect(await upgraded.words.count()).toBe(1);
    expect(await upgraded.meta.get('dataVersion')).toMatchObject({ value: '2026.10.01' });

    // 3) 新表是空的且可直接写入
    expect(await upgraded.translations.count()).toBe(0);
    expect(await upgraded.translationBook.count()).toBe(0);
    expect(await upgraded.secrets.count()).toBe(0);
    await upgraded.translations.put(makeItem('t_001', 'trad-culture'));
    await upgraded.translationBook.add({
      itemId: 't_001',
      topic: 'trad-culture',
      addedAt: NOW,
      resolved: false,
    });
    await upgraded.secrets.put({ id: 'llm.apiKey', value: 'sk-x', updatedAt: NOW });
    expect(await upgraded.translations.count()).toBe(1);
    expect(await upgraded.translationBook.count()).toBe(1);
    expect(await upgraded.secrets.count()).toBe(1);

    await closeDatabase(upgraded);
    await upgraded.delete();
  });
});
