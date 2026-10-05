import { db as defaultDb, PROGRESS_STORES, SECRET_STORES, type Cet4Database, type ProgressStoreName } from '@/data/db/db';
import { stripSecrets } from '@/domain/settings/secrets';
import { makeEnvelope, parseBackup } from './schemaVersion';

/**
 * 进度导入 / 导出 —— 纯本地（铁律 A2 + A7：**永不上传**任何数据）。
 *
 * ★ 只导出**用户进度区**（PROGRESS_STORES）。
 *   只读镜像区（words / sentences / papers / sections / questions）**不导出**：
 *   它们随站点分发、可由 `public/data` 整体重建，塞进备份只会让文件变得巨大且易过期。
 *
 * ★ 导入是唯一把外部数据写进 IndexedDB 的入口，故：
 *   - 先过 `parseBackup` 的版本契约，**校验不通过绝不写入**；
 *   - 自增主键表**一律剥掉 `id`** 再写入，让 Dexie 重新分配，避免与本地既有行撞主键；
 *   - 默认 `merge` 策略是**保留本地**（只补缺失），不会静默覆盖用户现有进度。
 */

/** 带业务主键的表：可直接 put（同键覆盖） */
const KEYED_STORES = ['cards', 'dailyStats', 'answerSheets', 'attempts'] as const;
/**
 * 自增主键表：导入时剥掉 id，按业务键去重。
 *
 * ⚠️ 新增自增表**必须**同时在这里登记 + 在 `dedupeKey` 里补一个 case，
 *    否则会出现「能导出、导入时却被静默丢弃」的单向备份（数据只出不进）。
 */
const AUTO_STORES = ['wrongBook', 'vocabBook', 'studyLogs', 'quizSessions', 'translationBook'] as const;

type AutoStore = (typeof AUTO_STORES)[number];

/** 导出的数据体：表名 → 行数组 */
export type ProgressDump = Partial<Record<ProgressStoreName, unknown[]>>;

/** 自增表的业务去重键（同一条数据重复导入不应变成两行） */
function dedupeKey(store: AutoStore, row: Record<string, unknown>): string {
  switch (store) {
    case 'wrongBook':
      return `${row.source}|${row.wordId ?? ''}|${row.questionId ?? ''}|${row.paperId ?? ''}`;
    case 'vocabBook':
      return String(row.wordId);
    case 'studyLogs':
      return `${row.ts}|${row.wordId}|${row.action}`;
    case 'quizSessions':
      return `${row.startedAt}|${row.type}`;
    case 'translationBook':
      return String(row.itemId);
  }
}

/**
 * 不变量：`SECRET_STORES`（明文凭据）**绝不**在导出范围内。
 *
 * 今天 `PROGRESS_STORES` 天然不含 `secrets`，所以"导出不含 Key"本来就已成立——
 * 但那是**靠"没人改过"维持的巧合**。这一步把它变成会抛错的断言。
 */
export function assertSecretsExcluded(stores: readonly string[]): void {
  const leaked = (SECRET_STORES as readonly string[]).filter((s) => stores.includes(s));
  if (leaked.length > 0) {
    throw new Error(`导出/导入范围不得包含密钥表：${leaked.join(', ')}`);
  }
}

/** 导出全部用户进度为 JSON 文本 */
export async function exportProgressJson(
  instance: Cet4Database = defaultDb,
  now: number = Date.now(),
): Promise<string> {
  assertSecretsExcluded(PROGRESS_STORES as readonly string[]);

  const dump: ProgressDump = {};
  for (const store of PROGRESS_STORES) {
    const table = instance.table(store);
    dump[store] = await table.toArray();
  }
  // ★ 防御性剔除：即便将来有人把 `secrets` 或明文 apiKey 混进进度区，
  //   导出文件里也绝不会带出密钥（docs/04b §5.14.8）
  return JSON.stringify(makeEnvelope(stripSecrets(dump), now), null, 2);
}

export interface ImportReport {
  /** 每个表实际写入的行数 */
  imported: Record<string, number>;
  /** merge 模式下因本地已存在而跳过的行数 */
  skipped: number;
  mode: ImportMode;
  /** 备份的导出时间（用于 UI 展示"来自 x 月 x 日的备份"） */
  exportedAt?: number;
}

export type ImportMode = 'merge' | 'replace';

/**
 * 导入进度。
 *
 * @param mode 'merge'（默认）：只补本地缺失的行，**不覆盖**既有进度；
 *             'replace'：先清空对应表再写入 —— 会丢失本地现有进度，UI 必须二次确认。
 */
export async function importProgressJson(
  text: string,
  options: { mode?: ImportMode; instance?: Cet4Database } = {},
): Promise<ImportReport> {
  const instance = options.instance ?? defaultDb;
  const mode: ImportMode = options.mode ?? 'merge';
  const env = parseBackup<ProgressDump>(text);
  // ★ 别人给我的备份里若含密钥，一律丢弃后再写库（不信任外部输入）
  const data = stripSecrets(env.data);

  const imported: Record<string, number> = {};
  let skipped = 0;

  await instance.transaction('rw', PROGRESS_STORES.map((s) => instance.table(s)), async () => {
    // 1) 带业务主键的表
    for (const store of KEYED_STORES) {
      const rows = (data[store] ?? []) as Array<Record<string, unknown>>;
      const table = instance.table(store);
      let written = 0;
      for (const row of rows) {
        const key = row[table.schema.primKey.keyPath as string];
        if (key === undefined || key === null) continue;
        if (mode === 'merge' && (await table.get(key)) !== undefined) {
          skipped += 1;
          continue;
        }
        await table.put(row);
        written += 1;
      }
      imported[store] = written;
    }

    // 2) 自增主键表：剥 id + 按业务键去重
    for (const store of AUTO_STORES) {
      const rows = (data[store] ?? []) as Array<Record<string, unknown>>;
      const table = instance.table(store);
      const existing = new Set<string>();
      if (mode === 'merge') {
        for (const row of (await table.toArray()) as Array<Record<string, unknown>>) {
          existing.add(dedupeKey(store, row));
        }
      } else {
        await table.clear();
      }
      let written = 0;
      for (const row of rows) {
        const key = dedupeKey(store, row);
        if (mode === 'merge' && existing.has(key)) {
          skipped += 1;
          continue;
        }
        existing.add(key);
        const { id: _dropped, ...rest } = row;
        await table.add(rest);
        written += 1;
      }
      imported[store] = written;
    }
  });

  return { imported, skipped, mode, exportedAt: env.exportedAt };
}
