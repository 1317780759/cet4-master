/**
 * IndexedDB 行类型 —— 只描述「落库形状」，不含业务算法。
 *
 * 与领域对象的边界：
 * - 词库 / 真题相关的行直接复用 `src/domain/` 的类型（Word / ExamPaper / …）
 * - 纯存储账本类（错题、生词、日志、统计、缓存）在此定义，形状与实现方案 3.4 对齐
 */

import type {
  AnswerSheet,
  ExamAttempt,
  ExamPaper,
  ExamQuestion,
  ExamSection,
  ExamSentence,
} from '@/domain/exam/types';
import type { FsrsRating, ReviewCard } from '@/domain/fsrs/types';
import type { Score, TranslationTopicKey } from '@/domain/translation/types';
import type { Word } from '@/domain/word/types';

export type { Word, ExamSentence, ExamPaper, ExamSection, ExamQuestion, AnswerSheet, ExamAttempt };
export type { ReviewCard };

/** v1.1：'mock' 明确区分真题模考来源 */
export type WrongSource = 'card' | 'quiz' | 'cloze' | 'listening' | 'mock' | 'practice';

/** 错题条目 —— 不是死列表，而是 FSRS 队列的活跃来源 */
export interface WrongBookRow {
  /** auto-increment */
  id?: number;
  /** 单词类错题（背词/测验来源） */
  wordId?: string;
  /** 真题小题类错题 */
  questionId?: string;
  /** 错题所属套卷，支持「按卷筛选重做」 */
  paperId?: string;
  source: WrongSource;
  /** 错误频次 → 「专项错题卷」排序依据 */
  wrongCount: number;
  firstWrongAt: number;
  lastWrongAt: number;
  /** 是否已注入 FSRS 队列（防止重复入队） */
  enqueued: boolean;
  /** 【索引】 */
  nextDue: number;
  /** 连续答对 N 次后自动归档 */
  resolved: boolean;
}

/** ★ 生词本 —— 与错题本分离的「主动收藏」语义 */
export interface VocabBookRow {
  /** auto-increment */
  id?: number;
  /** 【索引】 */
  wordId: string;
  /** 来源：真题里遇到的生词可回溯出处 */
  origin?: {
    paperId: string;
    questionId: string;
    sentenceId?: string;
  };
  addedAt: number;
  /** 是否已转入正式学习队列（生词本 → FSRS 卡片） */
  promoted: boolean;
  /** 用户自填笔记 */
  note?: string;
}

export type StudyAction = 'learn' | 'review' | 'quiz' | 'wrong' | 'master';

/** 事件级学习日志 —— 热力图 / 趋势图的数据源 */
export interface StudyLogRow {
  id?: number;
  ts: number;
  /** 'YYYY-MM-DD' 本地时区，便于按日聚合 */
  date: string;
  wordId: string;
  action: StudyAction;
  rating?: FsrsRating;
  peeked?: boolean;
  elapsedMs?: number;
}

/** 预聚合日统计（避免每次打开统计页扫全表日志） */
export interface DailyStatRow {
  /** 【主键】 */
  date: string;
  newLearned: number;
  reviewed: number;
  correct: number;
  wrong: number;
  minutes: number;
  goalDone: boolean;
}

export interface QuizSessionRow {
  id?: number;
  startedAt: number;
  finishedAt?: number;
  type: 'choice' | 'cloze' | 'rapid';
  correct?: number;
  total?: number;
}

export interface ListeningProgressRow {
  sectionId: string;
  updatedAt: number;
  playedSec?: number;
  lastLineIdx?: number;
}

/** 系统表：dataVersion / manifestHash / lastBackupAt / migration / settings */
export interface MetaRow {
  key: string;
  value: unknown;
}

/** TTS 音频 blob 缓存（默认关闭） */
export interface AudioCacheRow {
  url: string;
  cachedAt: number;
  blob: Blob;
}

/**
 * 秘钥行（SECRET_STORES / `secrets` 表）。
 *
 * ★ 存放的是明文凭据（如 LLM 批改的 API Key），只落本机 IndexedDB：
 *   - 导出备份**必须**剔除该表（因此它绝不能进 PROGRESS_STORES）；
 *   - 数据管线清镜像时也绝不能碰它（因此它绝不能进 MIRROR_STORES）。
 */
export interface SecretRow {
  /** 主键，如 `'llm.apiKey'` */
  id: string;
  /** 明文值 —— 任何日志 / Error message 都不得包含它 */
  value: string;
  updatedAt: number;
}

/**
 * 错句本（PROGRESS_STORES / `translationBook` 表）。
 *
 * ★ 只存「需要重做」的句，**不是**全量作答流水：
 *   答得好 → 不入本；答得差 → 入本（lastText / lastScore 只保留最近一次）。
 *   连续答对后由上层把 `resolved` 置 true 归档。
 */
export interface TranslationBookRow {
  /** auto-increment */
  id?: number;
  /** 关联 `translations.id` */
  itemId: string;
  /** 冗余话题，便于「按话题重做」免 join */
  topic: TranslationTopicKey;
  /** 最近一次作答的英文译文 */
  lastText?: string;
  /** 最近一次评分快照（不含逐条明细，体积可控） */
  lastScore?: Score;
  addedAt: number;
  /** 最近一次重做时间 */
  lastTriedAt?: number;
  /** true = 已掌握，归档不再出现在重做队列 */
  resolved: boolean;
  /** 用户自填笔记 */
  note?: string;
}
