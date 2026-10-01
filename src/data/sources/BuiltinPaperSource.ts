import type { ExamPaper } from '@/domain/exam/types';
import { dataBaseUrl, fetchJson } from '@/data/loader/manifest';
import type { PaperBundle, PaperSource, PaperSummary, PapersIndexFile } from './PaperSource';

const PAPERS_INDEX_FILE = 'papers/index.json';

/**
 * 内置套卷源：读 `public/data/papers/*.json`，默认只分发 `derived`（真题同源模拟卷）。
 *
 * ★ 铁律 A6 运行时门禁：`provenance='original'` 的卷**不得**由本源返回，
 * 即使有人误把文件放进 public/data 也会被这里拦下（CI 门禁之外的第二道防线）。
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
      // M0/M1 阶段 papers/index.json 尚未生成 —— 优雅降级为空目录，不阻断首屏
      return [];
    }
  }

  async loadPaper(paperId: string): Promise<PaperBundle> {
    const url = `${this.baseUrl}papers/${encodeURIComponent(paperId)}.json`;
    const bundle = await fetchJson<PaperBundle>(url);
    assertNotOriginal(bundle.paper);
    return {
      paper: bundle.paper,
      sections: bundle.sections ?? [],
      questions: bundle.questions ?? [],
    };
  }
}

/** A6 运行时断言 */
export function assertNotOriginal(paper: ExamPaper): void {
  if (paper.provenance === 'original') {
    throw new Error(
      `[铁律 A6] 内置源拒绝加载 provenance='original' 的卷：${paper.id}。该卷只能由用户自行导入。`,
    );
  }
}
