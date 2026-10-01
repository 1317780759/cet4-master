import type { ExamPaper, ExamQuestion, ExamSection } from '@/domain/exam/types';

/**
 * ★ 铁律 A4：套卷读取一律经 `PaperSource` 接口，
 * **内置样例与用户导入必须同构** —— 两者返回同一套 `PaperBundle`，
 * 使「真题从哪来」成为可配置项：我们默认不分发任何受保护内容，
 * 将来若获授权，只需加文件不改代码。
 */

/** 套卷目录条目（papers/index.json 的一行，≈8KB 的目录里放几十条） */
export interface PaperSummary {
  id: string;
  year: number;
  month: 6 | 12;
  setNo: number;
  provenance: ExamPaper['provenance'];
  provenanceLabel: string;
  questionCount: number;
  /** 是否有用户自备音频（铁律 A6：仓库内自带音频恒为 false） */
  hasAudio: boolean;
  confidenceLevel: 'high' | 'medium' | 'low';
}

/** 一套卷的完整数据（按套懒加载的单位） */
export interface PaperBundle {
  paper: ExamPaper;
  sections: ExamSection[];
  questions: ExamQuestion[];
}

/** papers/index.json 的形状 */
export interface PapersIndexFile {
  /** 音频是否默认缺失（铁律 A6：恒定 true） */
  defaultMissingAudio: boolean;
  papers: PaperSummary[];
}

export interface PaperSource {
  /** 'builtin' / 'user-import' */
  readonly id: string;

  /** 读取目录（轻量，首屏可安全调用） */
  listPapers(): Promise<PaperSummary[]>;

  /** 按 id 懒加载完整套卷 */
  loadPaper(paperId: string): Promise<PaperBundle>;
}
