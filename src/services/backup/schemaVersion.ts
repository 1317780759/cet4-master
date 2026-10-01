/**
 * 备份信封的版本契约。
 *
 * ★ 为什么单独一个文件：导入是**唯一会把外部数据写进 IndexedDB** 的入口，
 *   一旦信封格式变更而校验跟不上，就会静默写入半个备份（用户以为导回了，实际丢了一半）。
 *   版本校验必须**早于**任何写入，且不能散落在调用方。
 */

/** 当前备份格式版本。破坏性变更时 +1，并在 `isSupportedVersion` 里显式声明兼容范围。 */
export const BACKUP_SCHEMA_VERSION = 1;

export const BACKUP_APP_ID = 'cet4-master';

/** 备份信封 */
export interface BackupEnvelope<T = unknown> {
  /** ★ 版本契约字段，导入前必校验 */
  schemaVersion: number;
  app: typeof BACKUP_APP_ID;
  exportedAt: number;
  data: T;
}

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupParseError';
  }
}

/** 当前写入器能读的版本集合（向后兼容：老版本可读，新版本拒绝） */
export function isSupportedVersion(version: unknown): version is number {
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 && version <= BACKUP_SCHEMA_VERSION;
}

export function makeEnvelope<T>(data: T, exportedAt: number = Date.now()): BackupEnvelope<T> {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: BACKUP_APP_ID,
    exportedAt,
    data,
  };
}

/**
 * 解析并校验备份文本 —— **只做校验，不写任何数据**。
 * 任何一步不通过都抛 `BackupParseError`（调用方应展示错误而非继续导入）。
 */
export function parseBackup<T = unknown>(text: string): BackupEnvelope<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupParseError('不是合法的 JSON 文件');
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new BackupParseError('备份文件内容不是对象');
  }
  const env = raw as Partial<BackupEnvelope<T>>;

  if (!isSupportedVersion(env.schemaVersion)) {
    throw new BackupParseError(
      `备份版本不受支持：${String(env.schemaVersion)}（当前支持 1 ~ ${BACKUP_SCHEMA_VERSION}）`,
    );
  }
  if (env.app !== BACKUP_APP_ID) {
    throw new BackupParseError(`不是本站的备份文件（app=${String(env.app)}）`);
  }
  if (env.data === undefined || env.data === null) {
    throw new BackupParseError('备份缺少 data 字段');
  }

  return env as BackupEnvelope<T>;
}
