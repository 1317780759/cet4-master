import { dataBaseUrl, fetchJson } from '@/data/loader/manifest';

/**
 * 音标运行时（需求 1：单词下方显示音标）。
 *
 * ★ 设计前提（源自实测，不要"优化"掉）：
 *   - 音标是**独立产物**，不并进 words/chunk-*。合并会改 10 个 chunk 的 sha256 →
 *     manifest 变 → 所有老用户重灌 2.5 MB 词库（P0 禁令 G3）。
 *   - **懒加载**：不在 BootstrapGate 里 await，由页面自行触发，首屏零新增请求。
 *   - 全量 5278 词实测 **100% 覆盖**，gzip 约 75 KB，内存表 ≤0.7 MB。
 *
 * ★ 契约：**永不抛异常**。加载失败 / 断网 / 产物缺失一律静默降级为「无音标」，
 *   绝不让背词页白屏或卡在 loading。
 */

export const PHONETICS_FILE = 'phonetics/phonetics.full.json';

/** src 标记位：0 英音美音都原生 / 1 仅一侧有 / 2 人工补录 / 3 两侧都缺 */
export type PhoneticSrc = 0 | 1 | 2 | 3;

export interface PhoneticEntry {
  /** 英音 IPA（构建期已去掉首尾斜杠，展示时自行补回） */
  uk: string;
  /** 美音 IPA */
  us: string;
  src: PhoneticSrc;
}

interface PhoneticsFile {
  version: string;
  count: number;
  rows: Array<[string, string, string, PhoneticSrc]>;
}

let table: Map<string, PhoneticEntry> | null = null;
let inflight: Promise<void> | null = null;
/** 失败后置位：避免每个词都重试一次请求（离线时尤其重要） */
let disabled = false;

/** 触发加载（幂等；并发调用共享同一次请求） */
export function ensurePhonetics(): Promise<void> {
  if (table || disabled) return Promise.resolve();
  if (inflight) return inflight;

  inflight = (async (): Promise<void> => {
    try {
      const data = await fetchJson<PhoneticsFile>(`${dataBaseUrl()}${PHONETICS_FILE}`);
      const next = new Map<string, PhoneticEntry>();
      for (const row of data.rows ?? []) {
        const [id, uk, us, src] = row;
        if (typeof id !== 'string') continue;
        next.set(id, { uk: uk ?? '', us: us ?? '', src });
      }
      table = next;
    } catch {
      // 断网 / 产物缺失 / JSON 损坏 —— 一律静默降级
      disabled = true;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 同步读取（已加载才有值）；未加载返回 null，调用方不得据此报错 */
export function getPhonetic(wordId: string): PhoneticEntry | null {
  return table?.get(wordId) ?? null;
}

/** 是否已就绪（供测试与 UI 判断） */
export function isPhoneticsReady(): boolean {
  return table !== null;
}

/** 仅供测试：清空内存表 */
export function resetPhoneticsCache(): void {
  table = null;
  inflight = null;
  disabled = false;
}
