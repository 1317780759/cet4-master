import { beforeEach, describe, expect, it } from 'vitest';
import type { ReviewCard } from '@/domain/fsrs/types';
import { type Cet4Database, SECRET_STORES } from '@/data/db/db';
import { containsSecretText } from '@/domain/settings/secrets';
import { assertSecretsExcluded, exportProgressJson, importProgressJson } from '@/services/backup/exportImport';
import { makeEnvelope, parseBackup } from '@/services/backup/schemaVersion';
import { freshDb } from '@/services/__tests__/examFixture';

/**
 * 密钥不泄露 + 错句本可往返 —— docs/04b §5.14.8 的两条强制断言。
 *
 * ★ 为什么单独一个文件：这是"安全不变量"，不是"导入导出功能"。
 *   放在功能测试里容易被当成顺带覆盖的一项而被人误删；独立成文件后，
 *   它是一条会自己变红的安全门禁。
 */

const NOW = 1_700_000_000_000;
const SECRET = 'sk-live-REDACTED-TEST';

let db: Cet4Database;

/** 造一行「带脏字段」的进度数据（模拟有人误把 Key 写进设置/进度行） */
function dirty<T>(row: Record<string, unknown>): T {
  return row as unknown as T;
}

beforeEach(async () => {
  db = freshDb('secrets');
});

describe('导出绝不带出密钥', () => {
  it('★ 进度行里含明文 apiKey → 导出文本中不含该字符串', async () => {
    await db.cards.put(dirty<ReviewCard>({ wordId: 'w1', apiKey: SECRET }));

    const json = await exportProgressJson(db, NOW);
    expect(containsSecretText(json, SECRET)).toBe(false);
  });

  it('★ 嵌套的 aiConfig.apiKey 同样被剥离', async () => {
    await db.dailyStats.put(dirty<never>({
      date: '2026-10-02',
      newLearned: 1, reviewed: 1, correct: 1, wrong: 0, minutes: 1, goalDone: false,
      aiConfig: { enabled: true, apiKey: SECRET },
    }));

    const json = await exportProgressJson(db, NOW);
    expect(containsSecretText(json, SECRET)).toBe(false);
  });

  it('断言函数：导出范围一旦含密钥表立刻抛错', () => {
    expect(() => assertSecretsExcluded(['cards', 'vocabBook'])).not.toThrow();
    expect(() => assertSecretsExcluded([...SECRET_STORES])).toThrow(/密钥表/);
  });
});

describe('导入丢弃外部备份里的密钥', () => {
  it('★ 备份里含 apiKey → 写库后该字段不存在', async () => {
    const text = JSON.stringify(
      makeEnvelope({ cards: [{ wordId: 'w1', apiKey: SECRET, due: NOW, state: 'new' }] }, NOW),
    );

    await importProgressJson(text, { instance: db });

    const row = (await db.cards.get('w1')) as unknown as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.apiKey).toBeUndefined();
    expect(row?.wordId).toBe('w1');
  });

  it('★ 即便 secrets 表被塞进备份，也不会写进本地 secrets 表', async () => {
    const text = JSON.stringify(
      makeEnvelope({ secrets: [{ id: 'llm.apiKey', value: SECRET, updatedAt: NOW }] }, NOW),
    );

    await importProgressJson(text, { instance: db });

    // secrets 不在 PROGRESS_STORES，导入循环根本不会碰它 → 本地一行为空
    expect(await db.secrets.count()).toBe(0);
  });
});

describe('错句本（translationBook）可完整往返', () => {
  it('导出包含 translationBook，且导入后按 itemId 去重还原', async () => {
    await db.translationBook.add({
      itemId: 't_000101', topic: 'health', addedAt: NOW, resolved: false, lastText: 'a balanced diet',
    });
    await db.translationBook.add({
      itemId: 't_000102', topic: 'health', addedAt: NOW + 1, resolved: false,
    });

    const env = parseBackup<Record<string, unknown[]>>(await exportProgressJson(db, NOW));
    expect(env.data.translationBook).toHaveLength(2);

    const target = freshDb('secrets-import');
    const report = await importProgressJson(await exportProgressJson(db, NOW), { instance: target });

    expect(report.imported.translationBook).toBe(2);
    expect(await target.translationBook.count()).toBe(2);
    const row = await target.translationBook.where('itemId').equals('t_000101').first();
    expect(row?.lastText).toBe('a balanced diet');
    // 自增 id 必须被剥掉重新分配，不能照搬备份里的值
    expect(row?.id).toBeDefined();

    await target.delete();
  });

  it('重复导入同一份备份不会产生重复行（itemId 去重）', async () => {
    await db.translationBook.add({ itemId: 't_000201', topic: 'tech', addedAt: NOW, resolved: false });

    const json = await exportProgressJson(db, NOW);
    const target = freshDb('secrets-dedupe');
    await importProgressJson(json, { instance: target });
    const second = await importProgressJson(json, { instance: target });

    expect(second.imported.translationBook).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    expect(await target.translationBook.count()).toBe(1);

    await target.delete();
  });
});
