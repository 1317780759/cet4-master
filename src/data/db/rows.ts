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
