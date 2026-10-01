import type { ExamPaper } from '@/domain/exam/types';
import { dataBaseUrl, fetchJson } from '@/data/loader/manifest';
import type { PaperBundle, PaperSource, PaperSummary, PapersIndexFile } from './PaperSource';

const PAPERS_INDEX_FILE = 'papers/index.json';

/**
 * 内置套卷源：读 `public/data/papers/*.json`。
 *
 * ★ v1.3 路线（docs/02 §C11，用户已拍板）：内置分发 `original`
 *   （第三方公开渠道整理的历年试题文本）；`derived` 保留为 killSwitch 的降级目标，
 *   `user-imported` 为用户自备兜底。
 *
 * ★ 铁律 A6 在此的**真正**约束不是"禁止 original"，而是**音频零入库** ——
 *   内置卷永不携带任何音频字段（见 `assertNoAudioFields`）。
 */
export class BuiltinPaperSource implements PaperSource {
  readonly id = 'builtin';

  private readonly baseUrl: string;

  constructor(baseUrl: string = dataBaseUrl()) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  async listPapers(): Promise<PaperSummary[]> {
    const url = `${this.baseUrl}${PAPERS_INDEX_FILE}`;
    try {
      const index = await fetchJson<PapersIndexFile>(url, 10_000);
      return index.papers ?? [];
    } catch {
      // papers/index.json 尚未生成（T-M2-02 未完成）—— 优雅降级为空目录，不阻断首屏
      return [];
    }
  }

  async loadPaper(paperId: string): Promise<PaperBundle> {
    const url = `${this.baseUrl}papers/${encodeURIComponent(paperId)}.json`;
    const bundle = await fetchJson<PaperBundle>(url);
    assertNoAudioFields(bundle.paper);
    return {
      paper: bundle.paper,
      sections: bundle.sections ?? [],
      questions: bundle.questions ?? [],
    };
  }
}

/**
 * 递归收集所有**非空值**的 `audio*` 字段路径。
 *
 * 为什么递归而不只看顶层：音频字段可能嵌在 `sectionMeta[]`、`sections[]`、
 * `questions[]` 里（如 `audioTrackId` / `audioRange` / `audioUrl`），
 * 只查顶层会漏掉真正藏音频的地方。
 */
export function collectAudioKeys(value: unknown, path = '', out: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return out;

  if (Array.isArray(value)) {
    value.forEach((item, i) => collectAudioKeys(item, `${path}[${i}]`, out));
    return out;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path === '' ? key : `${path}.${key}`;
    if (/^audio/i.test(key)) {
      // undefined 不随 JSON 序列化，不构成实际携带；其余（'' / null / 对象 / 字符串）一律视为携带
      if (child !== undefined) out.push(next);
      continue;
    }
    collectAudioKeys(child, next, out);
  }
  return out;
}

/**
 * ★ 铁律 A6 运行时断言（CI 门禁之外的第二道防线）。
 *
 * ⚠️ 本函数**曾经**是 `assertNotOriginal` —— 直接拒绝 `provenance='original'` 的卷。
 *    那与用户拍板的 `original` 路线（docs/02 §C11）**直接冲突**：
 *    若保留，内置卷一条也加载不出来，功能等于没做。
 *
 *    故此处改为保留 A6 的**实质**约束（音频零入库），
 *    移除的只是与既定决策矛盾的那部分 —— 不是放宽合规，而是纠正一处实现与决策的脱节。
 *    音频邻接权风险高于文本、且官方从不发行数字音频（FM 广播实证），这条不变。
 */
export function assertNoAudioFields(paper: ExamPaper): void {
  const offenders = collectAudioKeys(paper);
  if (offenders.length > 0) {
    throw new Error(
      `[铁律 A6] 卷 ${paper.id} 携带音频字段：${offenders.join('、')}。内置卷不得包含任何音频字段。`,
    );
  }
}
