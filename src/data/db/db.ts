import Dexie, { type Table } from 'dexie';
import type {
  AnswerSheet,
  ExamAttempt,
  ExamPaper,
  ExamQuestion,
  ExamSection,
  ExamSentence,
} from '@/domain/exam/types';
import type { ReviewCard } from '@/domain/fsrs/types';
import type { TranslationItem } from '@/domain/translation/types';
import type { Word } from '@/domain/word/types';
import type {
  AudioCacheRow,
  DailyStatRow,
  ListeningProgressRow,
  MetaRow,
  QuizSessionRow,
  SecretRow,
  StudyLogRow,
  TranslationBookRow,
  VocabBookRow,
  WrongBookRow,
} from './rows';

/** 数据库名 */
export const DB_NAME = 'cet4-master';

/** 当前 schema 版本（v2 = 翻译训练 + 秘钥区） */
export const DB_VERSION = 2;

/**
 * ★ 分离原则（本文件最重要的一条注释）
 *
 * ┌─ 只读镜像区（MIRROR_STORES）──────────────────────────────┐
 * │ words / sentences / papers / sections / questions        │
 * │ 由 public/data 灌入，是远端数据的本机镜像，**可整体重建**。  │
 * │ 词库升级、换数据源、manifest 版本变更时，只清空这一区。      │
 * └──────────────────────────────────────────────────────────┘
 *
 * ┌─ 用户进度区（PROGRESS_STORES）────────────────────────────┐
 * │ cards / wrongBook / vocabBook / studyLogs / dailyStats / │
 * │ quizSessions / listeningProgress / answerSheets/attempts │
 * │ 用户自己的数据，**永不被数据管线触碰**。                     │
 * │ 即便词库换了源、词频重排，只要 Word.id 不变，进度就零损伤。  │
 * └──────────────────────────────────────────────────────────┘
 *
 * ┌─ 系统区（SYSTEM_STORES）─────────────────────────────────┐
 * │ meta（版本/配置/迁移记录） / audioCache                    │
 * └──────────────────────────────────────────────────────────┘
 *
 * ┌─ 秘钥区（SECRET_STORES）─────────────────────────────────┐
 * │ secrets（LLM API Key 等明文凭据，只落本机）                │
 * │ ★ 与其它三区**严格不相交**：                               │
 * │   - 不在 MIRROR_STORES  → 数据管线清镜像时不会被清掉       │
 * │   - 不在 PROGRESS_STORES→ 导出备份永远不会把它带出去       │
 * └──────────────────────────────────────────────────────────┘
 */
export const DB_SCHEMA = {
  // —— 只读镜像区（由 public/data 灌入，可整体重建）——
  words: 'id, freqRank, tier, chunk, headword, *variants',
  sentences: 'id, wordId, paperId, questionId, [wordId+paperId]',
  papers: 'id, year, [year+month], level, source',

  // —— 真题套卷镜像区（按套懒加载，用过的才入库）——
  sections: 'id, paperId, kind, [paperId+order]',
  questions: 'id, paperId, sectionId, no, kind, [paperId+no]',

  // —— 用户进度区（永不被数据管线触碰）——
  cards: 'wordId, due, state, lastReview, [state+due], suspended',
  wrongBook: '++id, wordId, questionId, paperId, source, nextDue, wrongCount, resolved',
  vocabBook: '++id, wordId, addedAt, promoted',
  studyLogs: '++id, date, ts, wordId, action',
  dailyStats: 'date',
  quizSessions: '++id, startedAt, type',
  listeningProgress: 'sectionId, updatedAt',

  // —— 模考区（答题卡高频写入，与 attempts 分离）——
  answerSheets: 'id, attemptId, paperId, lastSavedAt',
  attempts: 'id, paperId, startedAt, status, mode',

  // —— 系统区 ——
  meta: 'key',
  audioCache: 'url, cachedAt',
} as const;

/**
 * ★ v2 增量 schema —— **只声明变化的表**。
 *
 * Dexie 的 `version(n).stores()` 是「增量补丁」而非「全量快照」：
 * v2 只写新增/改索引的表，未提及的表自动沿用上一版定义。
 * 因此这里**绝不能**把 v1 的 16 张表抄进来 —— 抄了反而会让
 * 未声明的表在 v2 阶段被当成「删除索引」，且将来再加表时极易漏改。
 *
 * ⚠ Dexie 版本只能升不能降：v2 一旦发布，线上已有的 v2 库无法回到 v1。
 */
export const DB_SCHEMA_V2 = {
  translations: 'id, topic, difficulty, source',
  translationBook: '++id, itemId, addedAt, lastTriedAt, resolved',
  secrets: 'id',
} as const;

/** 只读镜像区：数据管线可整体重建 */
export const MIRROR_STORES = [
  'words',
  'sentences',
  'papers',
  'sections',
  'questions',
  'translations',
] as const;

/** 用户进度区：数据管线**绝不**清空 */
export const PROGRESS_STORES = [
  'cards',
  'wrongBook',
  'vocabBook',
  'studyLogs',
  'dailyStats',
  'quizSessions',
  'listeningProgress',
  'answerSheets',
  'attempts',
  'translationBook',
] as const;

/** 系统区 */
export const SYSTEM_STORES = ['meta', 'audioCache'] as const;

/**
 * 秘钥区：明文凭据，**只落本机**。
 * ★ 与 MIRROR / PROGRESS / SYSTEM 三区严格不相交（有单测守着这个不变量）。
 */
export const SECRET_STORES = ['secrets'] as const;

export type MirrorStoreName = (typeof MIRROR_STORES)[number];
export type ProgressStoreName = (typeof PROGRESS_STORES)[number];
export type SystemStoreName = (typeof SYSTEM_STORES)[number];
export type SecretStoreName = (typeof SECRET_STORES)[number];
export type StoreName = MirrorStoreName | ProgressStoreName | SystemStoreName | SecretStoreName;

/** Dexie 强类型数据库 */
export class Cet4Database extends Dexie {
  // 只读镜像区
  words!: Table<Word, string>;
  sentences!: Table<ExamSentence, string>;
  papers!: Table<ExamPaper, string>;
  sections!: Table<ExamSection, string>;
  questions!: Table<ExamQuestion, string>;
  /** 翻译题库镜像（由 data/translations 灌入，可整体重建） */
  translations!: Table<TranslationItem, string>;

  // 用户进度区
  cards!: Table<ReviewCard, string>;
  wrongBook!: Table<WrongBookRow, number>;
  vocabBook!: Table<VocabBookRow, number>;
  studyLogs!: Table<StudyLogRow, number>;
  dailyStats!: Table<DailyStatRow, string>;
  quizSessions!: Table<QuizSessionRow, number>;
  listeningProgress!: Table<ListeningProgressRow, string>;
  /** 错句本：只存「需要重做」的句，不是全量作答流水 */
  translationBook!: Table<TranslationBookRow, number>;

  // 模考区
  answerSheets!: Table<AnswerSheet, string>;
  attempts!: Table<ExamAttempt, string>;

  // 系统区
  meta!: Table<MetaRow, string>;
  audioCache!: Table<AudioCacheRow, string>;

  // 秘钥区（与进度区分离，导出备份绝不带走）
  secrets!: Table<SecretRow, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    // v1 基线原样保留；v2 只声明变化的表（见 DB_SCHEMA_V2 的注释）
    this.version(1).stores(DB_SCHEMA);
    this.version(2).stores(DB_SCHEMA_V2);
  }
}

/**
 * 全局默认实例。
 * 单测中应使用 `createDb()` 建独立实例，避免用例间互相污染。
 */
export const db = new Cet4Database();

/** 建一个独立实例（单测 / 多 profile 场景） */
export function createDb(name: string = DB_NAME): Cet4Database {
  return new Cet4Database(name);
}
