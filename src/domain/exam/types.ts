/**
 * 真题域类型 —— 铁律 A1：纯类型，零 React / 零 IO。
 *
 * v1.1 结构：真题从"例句集合"升级为完整套卷，三级结构 Paper → Section → Question。
 * ExamSentence 降级为 ExamQuestion 的关联数据，继续承载「单词 ↔ 真题语境」双向反查。
 *
 * M0 阶段本文件只定义类型，不实现任何逻辑（批改 / 计时 / 答题卡模型留到 M2）。
 */

export type ExamSectionKind = 'writing' | 'listening' | 'reading' | 'translation';

/** 一套真题（完整套卷，纯 JSON，无 PDF / 无 MP3） */
export interface ExamPaper {
  /** '2024-06-CET4-SET1' */
  id: string;
  year: number;
  month: 6 | 12;
  /** 同一考次的第几套卷 1..3 */
  setNo: number;
  level: 'CET4';
  /** 125（真实考试总时长，分钟） */
  durationMin: number;
  /** 710 */
  totalScore: number;
  /** 板块构成与分值分配，驱动答题卡分组与分项得分 */
  sectionMeta: ExamSectionMeta[];
  /** ★ 来源性质谱系（合规强制） */
  provenance: 'original' | 'derived' | 'user-imported';
  /**
   * - 'original'      : 真题原文复制 —— 🔴 CI 门禁禁止入库，仅用户导入时可能出现
   * - 'derived'       : 真题同源模拟卷（结构/考点取自真题语料，内容自撰）—— ✅ 默认内置
   * - 'user-imported' : 用户自行导入 —— ✅ 仅落本机 IndexedDB，永不上传分发
   */
  license?: string;
  /** provenance='user-imported' 时的导入时间戳 */
  importedAt?: number;
  /** derived 卷必须声明语料基准，例：'CET4 2024.06–2026.06 考点分布' */
  derivedFrom?: string;
  /** UI 必须展示的来源标识文案 */
  provenanceLabel: string;
  /** ★ 数据置信度 —— 无官方底本可对照，必须显式建模并展示 */
  confidence: ExamConfidence;
}

/** 数据置信度（无官方底本可对照，只能做一致性验收） */
export interface ExamConfidence {
  level: 'high' | 'medium' | 'low';
  hasTranscript: boolean;
  /** provenance='original' 时恒为 false（铁律 A6） */
  hasAudio: boolean;
  hasExplanation: boolean;
  /** 答案是否经 ≥2 个独立来源交叉比对一致 */
  answerCrossChecked: boolean;
  /** 人工抽样核对比例 0–1 */
  spotCheckRatio: number;
  /** 用户累计标记存疑次数，达阈值触发整卷熔断 */
  doubtCount: number;
  /** 例："2026.06 听力原文缺失，答案仅单来源" */
  note?: string;
}

export interface ExamSectionMeta {
  /** '2024-06-CET4-SET1:L' */
  id: string;
  kind: ExamSectionKind;
  /** 1=写作 2=听力 3=阅读 4=翻译（真实考试顺序） */
  order: number;
  /** 'Part I Writing' / 'Part II Listening' */
  partLabel: string;
  /** 起讫题号，用于答题卡分组 */
  questionFrom: number;
  questionTo: number;
  /** 建议用时（写作 30min / 听力 25min / 阅读 40min / 翻译 30min） */
  durationHintSec?: number;
  /** 该板块原始分（用于分项得分展示） */
  rawScore: number;
  /** 听力板块专属：指向 audio-index.json 的 track id */
  audioTrackId?: string;
}

/** 板块内的子分组（听力的 Section A/B/C、阅读的 Section A/B/C） */
export interface ExamSection {
  /** '...:L-A' */
  id: string;
  paperId: string;
  kind: ExamSectionKind;
  /** 'Section A / News Report' */
  subPart: string;
  /** 板块内顺序 */
  order: number;
  /** 该子分组的音频片段定位（在整轨 audio track 内的相对时间） */
  audioRange?: { startSec: number; endSec: number };
  /** 听力原文，按句切分 —— 精听、听写校验、TTS 降级合成的三合一数据源 */
  transcript?: TranscriptLine[];
  /** 阅读/完形的篇章材料（选词填空的备选词池也放这里） */
  passage?: {
    title?: string;
    paragraphs: string[];
    /** 选词填空（Section A）的 15 个备选词 */
    wordBank?: string[];
  };
  questions: ExamQuestion[];
}

export interface TranscriptLine {
  /** 句序号 */
  idx: number;
  /** 单句原文 */
  text: string;
  /** 句级译文（精听揭示用） */
  zh?: string;
  /** 句级时间轴，用于「点句跳转」；无数据时按文本长度比例估算 */
  startSec?: number;
  endSec?: number;
}

export type QuestionKind =
  /** 四选一（听力/阅读主流） */
  | 'choice'
  /** 选词填空（阅读 Section A） */
  | 'banked-cloze'
  /** 长篇阅读匹配（阅读 Section B） */
  | 'matching'
  /** 填空（听力 Section C 部分） */
  | 'blank'
  /** 汉译英段落 */
  | 'translation'
  /** 短文写作 */
  | 'essay';

/** 一道题 */
export interface ExamQuestion {
  /** '2024-06-CET4-SET1:Q23' */
  id: string;
  paperId: string;
  sectionId: string;
  kind: QuestionKind;
  /** 全局题号 1..57，答题卡排序依据 */
  no: number;
  /** 分值：听力/阅读客观题按 CET 权重表，写译为区间主观分 */
  score: number;
  /** 客观题标准答案；主观题（写作/翻译）无。'B' | 'banked:E3' | 'matching:I' */
  answer?: string;
  /** 主观题评分参考（写作/翻译），用于自评对照而非自动判分 */
  rubric?: string;
  /** 题干（选择题） */
  stem?: string;
  /** A-D 选项文本 */
  options?: string[];
  /** 该题依赖的材料指针：指向 section.passage 或 transcript 的区间 */
  materialRef?: {
    type: 'passage' | 'transcript';
    /** 在 paragraphs / transcript 中的索引或区间 */
    range: [number, number];
  };
  /** 解析（中文） */
  explanation?: string;
  /** 该题覆盖的真题例句 id → 支撑「单词 ↔ 真题」双向跳转 */
  sentenceIds?: string[];
  /** 关键词提示：交卷后用于「把本题生词加入生词本」的一键入口 */
  keyWordHints?: string[];
}

/**
 * 真题例句 —— 从 ExamQuestion / TranscriptLine 中抽取的「词级」切片。
 * 服务于「单词 ↔ 真题」反查的关联表。
 */
export interface ExamSentence {
  /** 's_000001' */
  id: string;
  wordId: string;
  /** '2024-06-CET4-SET1' */
  paperId: string;
  /** 反查到具体题目 */
  questionId: string;
  sectionKind: ExamSectionKind;
  questionNo?: number;
  /** 完整英文原句 */
  en: string;
  /** 参考译文 */
  zh?: string;
  /** 句中实际出现的词形（可能是 variants 之一） */
  targetForm: string;
  /** targetForm 在 en 中的字符区间 → 精确高亮（不用正则，避免误伤） */
  span: [number, number];
  /** 语境填空的挖空区间，复用 span 坐标系 */
  gap?: [number, number];
}

export type AttemptMode = 'mock' | 'practice';
export type AttemptStatus = 'ongoing' | 'submitted' | 'abandoned';
export type QuestionFlag = 'unanswered' | 'answered' | 'marked' | 'skipped';

/** 单题作答记录 */
export interface AnswerRecord {
  questionId: string;
  /** 客观题：选项字母；选词填空：词；匹配：段落号；主观题：全文文本 */
  value: string | null;
  /** 支持「标记待定」——长时考试必备 */
  flag: QuestionFlag;
  answeredAt?: number;
  /** 主观题自评档位（写作/翻译），用于分项得分估算 */
  selfScore?: number;
  /** 修改次数，用于统计"改答案"行为 */
  revisions?: number;
  /** ★ 用户认为该题答案可疑 → 该题错题不进 FSRS */
  doubtful?: boolean;
  doubtReason?: 'answer-wrong' | 'stem-unclear' | 'option-truncated' | 'other';
}

/** 答题卡 —— 一次模考的完整作答状态，★ 增量持久化，支撑断点续考 */
export interface AnswerSheet {
  /** attemptId（一对一） */
  id: string;
  attemptId: string;
  paperId: string;
  /** key = questionId */
  answers: Record<string, AnswerRecord>;
  /** 当前停留位置，恢复时直接滚动定位 */
  cursorQuestionId?: string;
  /** ★ 已用时（秒），由 ticks 累加，不用 Date 差值（防止切后台误差） */
  elapsedSec: number;
  startedAt: number;
  /** 增量保存时间戳（1s 节流 / 切页时强制） */
  lastSavedAt: number;
  /** 模考剩余时间；practice 模式为 null（不限时） */
  remainingSec: number | null;
  /** 听力音频加载状态，驱动 UI 降级 */
  audioState: 'idle' | 'loading' | 'ready' | 'failed' | 'tts-fallback';
}

/** 一次模考记录 —— 交卷后生成，供历史对比与统计 */
export interface ExamAttempt {
  id: string;
  paperId: string;
  mode: AttemptMode;
  status: AttemptStatus;
  startedAt: number;
  submittedAt?: number;
  elapsedSec: number;
  /** 客观题得分（自动批改，唯一可信数字） */
  objectiveScore: number;
  objectiveTotal: number;
  /** 分项得分：写作/听力/阅读/翻译 */
  sectionScores: Array<{
    kind: ExamSectionKind;
    correct: number;
    total: number;
    score: number;
    rawTotal: number;
  }>;
  /** 主观题只给自评档位，不做自动判分 */
  subjectiveSelfScore?: { writing?: number; translation?: number };
  /** ★ 明确不做 710 分制换算，避免误导 */
  scoreScaleNote: 'objective-only';
  /** → 错题入 FSRS 队列 */
  wrongQuestionIds: string[];
  /** → 生词入生词本 */
  newWordIds: string[];
}

/**
 * ★ 铁律 A6（类型层强制）：provenance='original' 的卷不得携带任何音频字段。
 * 音频邻接权风险高于文本，且官方从不发行数字音频（FM 广播实证）。
 */
export type OriginalExamPaper = Omit<ExamPaper, 'sectionMeta' | 'provenance'> & {
  provenance: 'original';
  sectionMeta: Array<Omit<ExamSectionMeta, 'audioTrackId'>>;
};

/**
 * derived 卷的「语料基准」——从近三年真题提取的事实性规格，不复制任何原文。
 * M2 的 scripts/build-derived-paper.ts 直接照此实现。
 */
export interface DerivedSpec {
  /** 语料基准考次，例：['2024.06','2024.12','2025.06','2025.12','2026.06'] */
  sourceSessions: string[];
  structure: {
    writing: { questions: 1; durationSec: 1800; rawScore: 106.5 };
    listening: { questions: 25; durationSec: 1500; rawScore: 248.5 };
    reading: { questions: 30; durationSec: 2400; rawScore: 248.5 };
    translation: { questions: 1; durationSec: 1800; rawScore: 106.5 };
    totalDurationSec: 7500;
  };
  /** 听力子结构：Section A 新闻 7 题 / B 长对话 8 题 / C 短文 10 题 */
  listeningParts: Array<{ subPart: string; questions: number; wordsPerMin: number }>;
  /** 阅读子结构：A 选词填空 10 / B 长篇匹配 10 / C 仔细阅读 10 */
  readingParts: Array<{ subPart: string; questions: number; passageWords: number }>;
  /** 题材分布（从近三年语料统计得出的事实性比例） */
  topicDistribution: Array<{ kind: ExamSectionKind; topic: string; weight: number }>;
  /** ★ 考点词取样：从 Word 表按 freqRank 区间抽取，保证考点词是真高频词 */
  targetWordPolicy: {
    rankRange: [number, number];
    perPaper: number;
    /** 与 ExamQuestion.keyWordHints 对齐，用于「一键加入生词本」 */
    emitWordHints: true;
  };
  writingGuidelines: {
    passageWords: { min: number; max: number };
    optionDistractors: 3;
    /** 禁止：复制任何真题原句、原文段落、原题干 */
    forbidVerbatimCopy: true;
  };
}
