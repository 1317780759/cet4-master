/**
 * 数据管线公共工具（构建期执行，Node + tsx）。
 * 只做三件事：路径解析、JSON 读写、sha256 计算。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（scripts/lib → 上两级） */
export const ROOT_DIR: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 原始数据源目录（.gitignore，绝不入库） */
export const RAW_DIR: string = path.join(ROOT_DIR, 'scripts', 'data', 'raw');

/** 管线中间产物目录（.gitignore） */
export const GENERATED_DIR: string = path.join(ROOT_DIR, 'scripts', 'data', 'generated');

/** 最终产物目录（运行时 fetch，会随站点一起部署） */
export const OUT_DIR: string = path.join(ROOT_DIR, 'public', 'data');

export const WORDS_OUT_DIR: string = path.join(OUT_DIR, 'words');

/** 计算 sha256（小写 hex），与浏览器端 crypto.subtle 的结果口径一致 */
export function sha256(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readText(file: string): Promise<string> {
  return readFile(file, 'utf8');
}

export async function readJson<T>(file: string): Promise<T> {
  const text = await readFile(file, 'utf8');
  return JSON.parse(text) as T;
}

/** 写入 JSON，并返回内容 sha256 与字节数（manifest 需要） */
export async function writeJson(
  file: string,
  value: unknown,
): Promise<{ bytes: number; sha256: string }> {
  await ensureDir(path.dirname(file));
  // 2 空格缩进：可读性与体积的折中（gzip 后差异极小）
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(file, text, 'utf8');
  return { bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) };
}

export async function writeText(file: string, text: string): Promise<number> {
  await ensureDir(path.dirname(file));
  await writeFile(file, text, 'utf8');
  return Buffer.byteLength(text, 'utf8');
}

/** 分片序号 → '001' */
export function pad3(n: number): string {
  return `${n}`.padStart(3, '0');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 'YYYY-MM-DD'（本地时区） */
export function todayKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 'YYYY.MM.DD'（manifest.version 的日期部分） */
export function versionDateKey(ts: number = Date.now()): string {
  return todayKey(ts).replace(/-/g, '.');
}
