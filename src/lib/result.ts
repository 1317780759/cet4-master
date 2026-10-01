/**
 * 轻量 Result 类型 —— 数据加载链路（IO 边界）不使用异常控制流，
 * 而是显式返回 ok / err，让调用方（BootstrapGate）能给出确定的 UI 状态。
 */

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** 把可能抛异常的计算包成 Result */
export function tryCatch<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/** 异步版本 */
export async function tryCatchAsync<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** 把 Error 收敛成可读文案（网络错误给出中文提示） */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TypeError' || /fetch|network/i.test(error.message)) {
      return '网络请求失败，请检查网络连接后重试';
    }
    return error.message;
  }
  return String(error);
}
