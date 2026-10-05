import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Cet4Database } from '@/data/db/db';
import { closeDatabase, openDatabase } from '@/data/db/migrations';
import {
  deleteSecret,
  getSecret,
  hasSecret,
  listSecretIds,
  putSecret,
} from '@/data/repos/secretRepo';

/**
 * 秘钥仓库单测。
 *
 * 🔴 安全红线回归：明文 value 绝不能被打印进 console，也绝不能进 Error message。
 *   下面「不得泄漏明文」一条用例会劫持 console.* 全家桶做兜底。
 */

const SECRET = 'sk-live-abcdef0123456789';
const SECRET_ID = 'llm.apiKey';

function freshName(tag: string): string {
  return `cet4-repo-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

let db: Cet4Database;

beforeEach(async () => {
  db = createDb(freshName('secret'));
  await openDatabase(db);
});

afterEach(async () => {
  await closeDatabase(db);
  await db.delete();
});

describe('secrets 表 CRUD', () => {
  it('put → get 往返一致', async () => {
    await putSecret(SECRET_ID, SECRET, db);

    expect(await getSecret(SECRET_ID, db)).toBe(SECRET);
    expect(await db.secrets.count()).toBe(1);
  });

  it('不存在的 key 返回 null 而不是抛错', async () => {
    expect(await getSecret('nope', db)).toBeNull();
  });

  it('已存在时覆盖（不产生第二行）', async () => {
    await putSecret(SECRET_ID, 'sk-old-value', db);
    const firstAt = (await db.secrets.get(SECRET_ID))?.updatedAt ?? 0;

    await putSecret(SECRET_ID, SECRET, db);

    expect(await db.secrets.count()).toBe(1);
    expect(await getSecret(SECRET_ID, db)).toBe(SECRET);
    expect((await db.secrets.get(SECRET_ID))?.updatedAt).toBeGreaterThanOrEqual(firstAt);
  });

  it('hasSecret 只判定存在性', async () => {
    expect(await hasSecret(SECRET_ID, db)).toBe(false);
    await putSecret(SECRET_ID, SECRET, db);
    expect(await hasSecret(SECRET_ID, db)).toBe(true);
    expect(await hasSecret('other', db)).toBe(false);
  });

  it('deleteSecret 删除；删除后再取为 null，重复删除不抛错', async () => {
    await putSecret(SECRET_ID, SECRET, db);
    await deleteSecret(SECRET_ID, db);

    expect(await db.secrets.count()).toBe(0);
    expect(await getSecret(SECRET_ID, db)).toBeNull();
    expect(await hasSecret(SECRET_ID, db)).toBe(false);
    await expect(deleteSecret(SECRET_ID, db)).resolves.toBeUndefined();
  });

  it('listSecretIds 只给 id，不给明文', async () => {
    await putSecret(SECRET_ID, SECRET, db);
    await putSecret('llm.model', 'gpt-x', db);

    const ids = await listSecretIds(db);
    expect(ids.sort()).toEqual([SECRET_ID, 'llm.model'].sort());
    expect(ids).not.toContain(SECRET);
  });

  it('★ 不得泄漏明文：全程 console 输出中不含 value', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    ];

    await putSecret(SECRET_ID, SECRET, db);
    await getSecret(SECRET_ID, db);
    await hasSecret(SECRET_ID, db);
    await listSecretIds(db);
    await deleteSecret(SECRET_ID, db);
    await getSecret('missing-key', db);

    const printed = spies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => String(arg))
      .join('\n');

    expect(printed).not.toContain(SECRET);
    for (const spy of spies) {
      spy.mockRestore();
    }
  });
});
