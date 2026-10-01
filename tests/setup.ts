/**
 * Vitest 全局初始化：
 * - fake-indexeddb 为 Dexie 提供 IndexedDB 实现（jsdom 原生不带）
 * - 数据层单测因此可以直接跑真实的 Dexie 读写，而不是 mock 掉的假仓库
 */
import 'fake-indexeddb/auto';

/**
 * React 19 要求测试环境显式声明支持 act()，否则每次状态更新都会打印
 * "The current testing environment is not configured to support act(...)"。
 * 声明后 Testing Library 的 render/waitFor 会正确包裹 act，消除噪声警告。
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
