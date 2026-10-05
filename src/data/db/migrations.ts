import {
  db,
  DB_VERSION,
  MIRROR_STORES,
  PROGRESS_STORES,
  SECRET_STORES,
  SYSTEM_STORES,
} from './db';
import type { Cet4Database } from './db';

/**
 * Dexie 版本迁移登记簿。
 *
 * v1 是基线版本（建表即完成），因此没有 upgrade 回调；
 * 后续每次改 schema 都必须在这里补一条 `onVersion(n)`，
 * 并**保证只操作 MIRROR_STORES，绝不触碰 PROGRESS_STORES / SECRET_STORES**。
 *
 * v2 = 翻译训练（translations 镜像 + translationBook 进度）+ 秘钥区（secrets）。
 * 建表由 `Cet4Database` 构造函数的 `version(2).stores(DB_SCHEMA_V2)` 完成，
 * 无需 upgrade 回调（v1 已有数据全部保留，只是多了三张空表）。
 */

export interface MigrationRecord {
  version: number;
  appliedAt: number;
  note: string;
}

export const MIGRATION_META_KEY = 'migration';

/** 打开数据库并确保 schema 已就绪 */
export async function openDatabase(instance: Cet4Database = db): Promise<Cet4Database> {
  if (!instance.isOpen()) {
    await instance.open();
  }
  return instance;
}

/** 读取已记录的迁移信息（首次运行时为 null） */
export async function readMigrationRecord(
  instance: Cet4Database = db,
): Promise<MigrationRecord | null> {
  const row = await instance.meta.get(MIGRATION_META_KEY);
  if (!row) return null;
  return (row.value as MigrationRecord | null) ?? null;
}

/** 写入迁移记录；已记录过更高版本时不回退 */
export async function recordMigration(
  note: string,
  instance: Cet4Database = db,
): Promise<MigrationRecord> {
  const now = Date.now();
  const existing = await readMigrationRecord(instance);
  const record: MigrationRecord = {
    version: Math.max(DB_VERSION, existing?.version ?? 0),
    appliedAt: existing?.appliedAt ?? now,
    note,
  };
  await instance.meta.put({ key: MIGRATION_META_KEY, value: record });
  return record;
}

/** 关闭数据库（单测 teardown 用） */
export async function closeDatabase(instance: Cet4Database = db): Promise<void> {
  if (instance.isOpen()) instance.close();
}

/** 启动自检：确认所有 store 均已建好且可访问 */
export async function verifySchema(instance: Cet4Database = db): Promise<{
  ok: boolean;
  version: number;
  stores: string[];
  missing: string[];
}> {
  // ★ 四区全量：新增分区时必须同步这里，否则新表不会被启动自检覆盖到
  const expected = [
    ...MIRROR_STORES,
    ...PROGRESS_STORES,
    ...SYSTEM_STORES,
    ...SECRET_STORES,
  ];
  const missing: string[] = [];
  for (const name of expected) {
    const table = instance.table(name);
    if (!table) {
      missing.push(name);
      continue;
    }
    try {
      await table.limit(1).toArray();
    } catch {
      missing.push(name);
    }
  }
  return {
    ok: missing.length === 0,
    version: instance.verno,
    stores: expected.filter((n) => !missing.includes(n)),
    missing,
  };
}
