import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import type { SecretRow } from '@/data/db/rows';

/**
 * 秘钥仓库 —— `secrets` 表（SECRET_STORES）。
 *
 * 🔴 安全红线（有单测守着）：
 *   1. 任何函数**不得** `console.*` 打印 `value`；
 *   2. 任何 Error message **不得**拼接 `value`（报错只提 id）；
 *   3. 本表**不在** PROGRESS_STORES 里 —— 导出备份天然不会带出去；
 *      调用方也**不要**把它加进任何 dump / 上报 payload。
 *
 * 所有函数都接受可选 `instance`，单测可注入独立 Dexie 实例。
 */

/** 读取秘钥；不存在返回 null */
export async function getSecret(
  id: string,
  instance: Cet4Database = defaultDb,
): Promise<string | null> {
  const row = await instance.secrets.get(id);
  if (!row) return null;
  return row.value;
}

/** 写入 / 覆盖秘钥（updatedAt 自动刷新） */
export async function putSecret(
  id: string,
  value: string,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  const row: SecretRow = { id, value, updatedAt: Date.now() };
  await instance.secrets.put(row);
}

/** 删除秘钥；不存在时静默返回 */
export async function deleteSecret(
  id: string,
  instance: Cet4Database = defaultDb,
): Promise<void> {
  await instance.secrets.delete(id);
}

/** 是否存在（不读出明文） */
export async function hasSecret(
  id: string,
  instance: Cet4Database = defaultDb,
): Promise<boolean> {
  const count = await instance.secrets.where('id').equals(id).count();
  return count > 0;
}

/** 已配置的秘钥 id 列表（UI 只展示 id，不展示明文） */
export async function listSecretIds(instance: Cet4Database = defaultDb): Promise<string[]> {
  const rows = await instance.secrets.toArray();
  return rows.map((row) => row.id);
}
