import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type UserSettings,
} from '@/domain/settings/types';
import { getMeta, setMeta } from './wordRepo';

export const SETTINGS_META_KEY = 'settings';
export const LAST_BACKUP_META_KEY = 'lastBackupAt';

/**
 * 设置仓库 —— 存在 `meta` 表（系统区），
 * 与 `dataVersion` 同表但不同键：词库升级清空镜像区时**不会**波及设置。
 */

export async function getSettings(instance: Cet4Database = defaultDb): Promise<UserSettings> {
  const stored = await getMeta<Partial<UserSettings>>(SETTINGS_META_KEY, instance);
  return mergeSettings(stored);
}

export async function saveSettings(
  patch: Partial<UserSettings>,
  instance: Cet4Database = defaultDb,
): Promise<UserSettings> {
  const next = mergeSettings({ ...(await getSettings(instance)), ...patch });
  await setMeta(SETTINGS_META_KEY, next, instance);
  return next;
}

export async function resetSettings(instance: Cet4Database = defaultDb): Promise<UserSettings> {
  await setMeta(SETTINGS_META_KEY, DEFAULT_SETTINGS, instance);
  return { ...DEFAULT_SETTINGS };
}

/** 上次导出备份时间（Dashboard 提醒用），未备份过为 null */
export async function getLastBackupAt(instance: Cet4Database = defaultDb): Promise<number | null> {
  return getMeta<number>(LAST_BACKUP_META_KEY, instance);
}

export async function markBackedUp(
  ts: number = Date.now(),
  instance: Cet4Database = defaultDb,
): Promise<void> {
  await setMeta(LAST_BACKUP_META_KEY, ts, instance);
}
