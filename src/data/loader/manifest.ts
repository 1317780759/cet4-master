import type { DataManifest } from '@/data/types';

/** manifest 相对 data 根目录的路径 */
export const MANIFEST_FILE = 'manifest.json';

/**
 * public/data 的根 URL。
 * ★ 数据永不进 JS bundle：这里只拼 URL，绝不 import 任何 JSON。
 */
export function dataBaseUrl(): string {
  const raw = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  const normalized = raw.endsWith('/') ? raw : `${raw}/`;
  return `${normalized}data/`;
}

/** 带超时与错误归一化的 fetch JSON */
export async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-cache',
    });
    if (!res.ok) {
      throw new Error(`GET ${url} 失败：HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 拉取文本并同时返回原始 bytes（用于 sha256 校验） */
export async function fetchTextWithBytes(
  url: string,
  timeoutMs = 15_000,
): Promise<{ text: string; bytes: ArrayBuffer }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-cache',
    });
    if (!res.ok) {
      throw new Error(`GET ${url} 失败：HTTP ${res.status}`);
    }
    const bytes = await res.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(bytes);
    return { text, bytes };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 计算 sha256（小写 hex）。
 * 非安全上下文（如 http 内网调试）下 crypto.subtle 不可用 → 返回 null，
 * 调用方据此**跳过**校验而不是失败（降级优于阻断）。
 */
export async function sha256Hex(payload: string | ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const data =
      typeof payload === 'string' ? new TextEncoder().encode(payload) : new Uint8Array(payload);
    const digest = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/**
 * 校验载荷 sha256 是否与期望一致。
 * expected 为空 / 环境不支持 → 视为通过（返回 true），避免误伤。
 */
export async function verifySha256(
  payload: string | ArrayBuffer,
  expected?: string,
): Promise<boolean> {
  if (!expected) return true;
  const actual = await sha256Hex(payload);
  if (actual === null) return true;
  return actual === expected.toLowerCase();
}

/** 读取 manifest（启动自检的第一步） */
export async function fetchManifest(baseUrl: string = dataBaseUrl()): Promise<DataManifest> {
  return fetchJson<DataManifest>(`${baseUrl}${MANIFEST_FILE}`);
}

/** 判断本地版本与远端 manifest 是否一致 —— 决定是否跳过下载 */
export function isUpToDate(local: { version?: string | null }, remote: DataManifest): boolean {
  return Boolean(local.version) && local.version === remote.version;
}
