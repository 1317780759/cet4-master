import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db as defaultDb, type Cet4Database } from '@/data/db/db';
import { openDatabase, recordMigration, verifySchema } from '@/data/db/migrations';
import { describeError } from '@/lib/result';

export type DbStatus = 'opening' | 'ready' | 'error';

interface DbContextValue {
  db: Cet4Database;
  status: DbStatus;
  error: string | null;
  /** 建表自检结果（store 数量 / 缺失项） */
  schema: { ok: boolean; version: number; stores: string[]; missing: string[] } | null;
}

const DbContext = createContext<DbContextValue | null>(null);

export interface DbProviderProps {
  children: ReactNode;
  /** 单测可注入独立实例 */
  instance?: Cet4Database;
}

/**
 * 打开 Dexie + 版本迁移 + 启动自检（store 是否齐全可读写）。
 * 只有 `status === 'ready'` 后才允许渲染业务路由，避免半开状态下读写报错。
 */
export function DbProvider({ children, instance }: DbProviderProps): ReactNode {
  const target = instance ?? defaultDb;
  const [status, setStatus] = useState<DbStatus>('opening');
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<DbContextValue['schema']>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('opening');
    setError(null);

    void (async (): Promise<void> => {
      try {
        await openDatabase(target);
        await recordMigration('v1 基线 schema：16 个 store', target);
        const check = await verifySchema(target);
        if (cancelled) return;
        setSchema(check);
        if (!check.ok) {
          throw new Error(`以下 store 不可用：${check.missing.join(', ')}`);
        }
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(describeError(e));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target]);

  const value = useMemo<DbContextValue>(
    () => ({ db: target, status, error, schema }),
    [target, status, error, schema],
  );

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDbContext(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDbContext 必须在 <DbProvider> 内部使用');
  return ctx;
}

/** 直接拿 Dexie 实例（repos 的默认参数就是它） */
export function useDb(): Cet4Database {
  return useDbContext().db;
}
