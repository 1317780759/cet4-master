/**
 * 密钥剥离纯函数（铁律 A1：零 React / 零 IO / 零网络，可 100% 单测）。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.14.8。
 *
 * ★ 为什么"结构上已安全"还要有这一层：
 *   当前 `PROGRESS_STORES` 不含 `secrets`、也不含 `meta`（settings 所在），
 *   **本来就不会导出密钥**。但那是**靠"没人改过"维持的巧合** ——
 *   与禁用词门禁那次「fixture 恰好不在扫描范围」是同一类问题。
 *   这一层把"导出不含 Key"从巧合变成**会变红的不变量**。
 *
 * ★ 本文件不重复定义 `SECRET_STORES` —— 那是存储层（`src/data/db/db.ts`）的职责，
 *   放两处迟早会漂移。这里只管**按路径剥离**这一件事。
 */

/**
 * 兜底路径：即便有人把明文 Key 塞进了别处，也在这几条路径上删掉。
 *
 * - `aiConfig.apiKey` —— 最可能发生的误放（把明文写进 UserSettings）
 * - `apiKey`          —— 任何行顶层的裸字段
 */
export const SECRET_FIELD_PATHS = ['aiConfig.apiKey', 'apiKey'] as const;

/** 深拷贝：优先 structuredClone，环境缺失时退回 JSON 往返 */
function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 按点分路径删除末段字段；中途遇到非对象就直接放弃（脏数据不该让导出崩掉） */
function deleteAtPath(target: unknown, path: string): void {
  const parts = path.split('.');
  const last = parts.length - 1;
  let cursor: Record<string, unknown> | null = target as Record<string, unknown> | null;

  for (let i = 0; i < last; i += 1) {
    if (cursor === null || typeof cursor !== 'object') return;
    const next: unknown = cursor[parts[i] as string];
    cursor = (next !== null && typeof next === 'object'
      ? (next as Record<string, unknown>)
      : null);
  }
  if (cursor !== null && typeof cursor === 'object') {
    delete cursor[parts[last] as string];
  }
}

/**
 * 深拷贝后按 `SECRET_FIELD_PATHS` 删除密钥字段；**不改原对象**。
 *
 * 输入一般是 `ProgressDump`（`{ [store]: row[] }`），但刻意写成通用的：
 * 数组逐行剥离，对象逐字段剥离，其余原样返回。
 */
export function stripSecrets<T>(dump: T): T {
  const cloned = deepClone(dump);
  if (cloned === null || typeof cloned !== 'object') return cloned;

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const path of SECRET_FIELD_PATHS) deleteAtPath(node, path);
    for (const value of Object.values(node as Record<string, unknown>)) walk(value);
  };

  if (Array.isArray(cloned)) {
    for (const item of cloned) walk(item);
  } else {
    walk(cloned);
  }
  return cloned;
}

/**
 * 测试辅助：断言序列化文本中不含密钥明文。
 *
 * 空 secret 一律返回 false —— 否则 `containsSecretText(text, '')` 恒为 true，
 * 会让"空 Key"的用例假通过。
 */
export function containsSecretText(text: string, secret: string): boolean {
  if (!secret) return false;
  return text.includes(secret);
}

/** 掩码尾部字符数：不足以被反推，但足以让用户认出"这是我刚存的那个 Key" */
export const MASK_TAIL_LENGTH = 4;

/**
 * 已保存 Key 的显示文案：`已保存（••••3f2a）`。
 *
 * 🔴 **永不回显明文**：只取尾部 4 个字符，其余一律替换为圆点。
 * 短于 4 位的 Key（正常 Key 不会这么短）只显示圆点，不泄露任何一位。
 *
 * @param secret 已存于 `secrets` 表的明文；null / 空串 → 返回 `'未保存'`
 */
export function maskedKeyLabel(secret: string | null | undefined): string {
  if (typeof secret !== 'string' || secret.length === 0) return '未保存';
  //★ 短于尾长时不显示任何字符 —— 3 位 Key 会被"全露"，宁可不显示也不泄露
  if (secret.length <= MASK_TAIL_LENGTH) return `已保存（••••••••）`;
  return `已保存（••••${secret.slice(-MASK_TAIL_LENGTH)}）`;
}
