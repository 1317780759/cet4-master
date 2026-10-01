/**
 * 断言工具：用于在「理论上不可能发生」的分支上做防御，
 * 并在生产构建中给出可读的错误信息（而不是 undefined 满天飞）。
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[invariant] ${message}`);
  }
}

/** 穷尽性检查：switch 覆盖所有联合类型分支后仍走到这里 → 编译期报错 */
export function assertNever(value: never, context = 'unknown'): never {
  throw new Error(`[assertNever] 未处理的分支：${context} → ${JSON.stringify(value)}`);
}
