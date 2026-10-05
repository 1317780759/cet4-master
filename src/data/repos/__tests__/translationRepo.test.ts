import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Cet4Database } from '@/data/db/db';
import { closeDatabase, openDatabase } from '@/data/db/migrations';
import {
  addTranslationBookRow,
  clearTranslations,
  countTranslations,
  findTranslationBookRow,
  getTranslation,
  listTranslationsByTopic,
  listTranslationBook,
  listUnresolvedTranslationBook,
  markTranslationResolved,
  mirrorTranslations,
  removeTranslationBookRow,
} from '@/data/repos/translationRepo';
import type { TranslationBookRow } from '@/data/db/rows';
import type { Score, TranslationItem, TranslationTopicKey } from '@/domain/translation/types';

/**
 * 翻译训练仓库 CRUD 单测（镜像区 translations + 进度区 translationBook）。
 * 仓库层只做增删改查，不含任何业务算法。
 */

const NOW = 1_700_000_000_000;

function makeItem(id: string, topic: TranslationTopicKey, difficulty: 1 | 2 | 3 = 2): TranslationItem {
  return {
    id,
    topic,
    difficulty,
    zh: `${id} 的中文题干`,
    reference: `Reference of ${id}.`,
    keyPoints: [{ id: 'kp1', head: 'reference', zh: '参考' }],
    source: 'authored',
  };
}

const SCORE: Score = { hit: 2, total: 3, ratio: 0.67, band: 2, scoredBy: 'offline' };

function makeBookRow(itemId: string, topic: TranslationTopicKey, addedAt: number): TranslationBookRow {
  return { itemId, topic, addedAt, resolved: false };
}

function freshName(tag: string): string {
  return `cet4-repo-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

describe('translations 镜像区', () => {
  it('mirrorTranslations 批量灌入，可按话题 / 主键查询', async () => {
    const written = await mirrorTranslations(
      [
        makeItem('t_001', 'trad-culture'),
        makeItem('t_002', 'trad-culture', 3),
        makeItem('t_003', 'food'),
      ],
      db,
    );

    expect(written).toBe(3);
    expect(await countTranslations(db)).toBe(3);

    const culture = await listTranslationsByTopic('trad-culture', db);
    expect(culture).toHaveLength(2);
    expect(culture.map((i) => i.id).sort()).toEqual(['t_001', 't_002']);

    expect(await listTranslationsByTopic('food', db)).toHaveLength(1);
    expect(await getTranslation('t_002', db)).toMatchObject({ difficulty: 3 });
    expect(await getTranslation('t_not_exist', db)).toBeUndefined();
  });

  it('同 id 重复灌入是覆盖而非追加（幂等）', async () => {
    await mirrorTranslations([makeItem('t_001', 'trad-culture', 1)], db);
    await mirrorTranslations([makeItem('t_001', 'trad-culture', 3)], db);

    expect(await countTranslations(db)).toBe(1);
    expect(await getTranslation('t_001', db)).toMatchObject({ difficulty: 3 });
  });

  it('空数组不写入且不报错', async () => {
    expect(await mirrorTranslations([], db)).toBe(0);
    expect(await countTranslations(db)).toBe(0);
  });

  it('clearTranslations 只清翻译镜像', async () => {
    await mirrorTranslations([makeItem('t_001', 'trad-culture')], db);
    await db.translationBook.add(makeBookRow('t_001', 'trad-culture', NOW));

    await clearTranslations(db);

    expect(await countTranslations(db)).toBe(0);
    expect(await db.translationBook.count()).toBe(1);
  });
});

describe('translationBook 错句本（进度区）', () => {
  it('新增 → 查询 → 列出', async () => {
    const id = await addTranslationBookRow(
      { ...makeBookRow('t_001', 'trad-culture', NOW), lastText: 'Paper cutting is ...', lastScore: SCORE },
      db,
    );

    expect(typeof id).toBe('number');
    const row = await findTranslationBookRow('t_001', db);
    expect(row).toMatchObject({ id, itemId: 't_001', resolved: false });
    expect(row?.lastScore).toEqual(SCORE);

    const rows = await listTranslationBook(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
  });

  it('带 id 的行是 upsert（覆盖）', async () => {
    const id = await addTranslationBookRow(makeBookRow('t_001', 'trad-culture', NOW), db);
    await addTranslationBookRow(
      {
        ...makeBookRow('t_001', 'trad-culture', NOW),
        id,
        resolved: true,
        note: '已掌握',
      },
      db,
    );

    const rows = await listTranslationBook(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, resolved: true, note: '已掌握' });
  });

  it('markTranslationResolved 归档 / 取消归档', async () => {
    await addTranslationBookRow(makeBookRow('t_001', 'trad-culture', NOW), db);
    await addTranslationBookRow(makeBookRow('t_002', 'food', NOW + 1), db);

    await markTranslationResolved('t_001', true, db);

    expect(await findTranslationBookRow('t_001', db)).toMatchObject({ resolved: true });
    const unresolved = await listUnresolvedTranslationBook(db);
    expect(unresolved.map((r) => r.itemId)).toEqual(['t_002']);

    await markTranslationResolved('t_001', false, db);
    expect(await findTranslationBookRow('t_001', db)).toMatchObject({ resolved: false });
    expect(await listUnresolvedTranslationBook(db)).toHaveLength(2);
  });

  it('对不存在的 itemId 操作不抛错（静默）', async () => {
    await expect(markTranslationResolved('t_ghost', true, db)).resolves.toBeUndefined();
    await expect(removeTranslationBookRow('t_ghost', db)).resolves.toBeUndefined();
    expect(await db.translationBook.count()).toBe(0);
  });

  it('removeTranslationBookRow 按 itemId 删除，其它行不受影响', async () => {
    await addTranslationBookRow(makeBookRow('t_001', 'trad-culture', NOW), db);
    await addTranslationBookRow(makeBookRow('t_002', 'food', NOW + 1), db);

    await removeTranslationBookRow('t_001', db);

    const rows = await listTranslationBook(db);
    expect(rows.map((r) => r.itemId)).toEqual(['t_002']);
  });

  it('列出顺序：最近加入的在前', async () => {
    await addTranslationBookRow(makeBookRow('t_001', 'trad-culture', NOW), db);
    await addTranslationBookRow(makeBookRow('t_002', 'food', NOW + 10), db);
    await addTranslationBookRow(makeBookRow('t_003', 'tech', NOW + 5), db);

    expect((await listTranslationBook(db)).map((r) => r.itemId)).toEqual([
      't_002',
      't_003',
      't_001',
    ]);
  });
});
