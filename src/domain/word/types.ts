/**
 * 词库域类型 —— 铁律 A1：本文件及整个 `src/domain/` 目录
 * ① 不得 import React   ② 不得触碰 IndexedDB   ③ 不得发起网络请求。
 * 这里只能放纯类型与纯函数，保证可 100% 单测。
 */

/** 词性枚举。`unknown` 是因为当前数据源（exam-data/CETVocabulary）只提供中文释义、不标注词性 */
export type Pos =
  | 'n'
  | 'v'
  | 'adj'
  | 'adv'
  | 'prep'
  | 'conj'
  | 'pron'
  | 'num'
  | 'art'
  | 'int'
  | 'unknown';

/** 单个义项 */
export interface WordSense {
  pos: Pos;
  /** 中文释义 */
  zh: string;
}

/** 词频档位：对应 PRD R01 的三档切换 */
export type Tier = 'core2104' | 'cet4' | 'extended';

/**
 * 词条（只读镜像，存在 IndexedDB.words，由 public/data 灌入）
 *
 * 关键：`id` 是稳定主键，与 `freqRank` 解耦 —— 换数据源重排词频时用户进度不丢。
 * 因此 id 采用「headword 归一化 slug」而非序号（序号会随重排变动，见实现方案硬约束 6）。
 */
export interface Word {
  /** 'w_abandon' 稳定主键，永不变更 */
  id: string;
  /** 'abandon' */
  headword: string;
  /** ['abandons','abandoned'] 词形还原 / 例句匹配用 */
  variants: string[];
  phoneticUk?: string;
  phoneticUs?: string;
  senses: WordSense[];
  /** 1..N 真卷词频降序 —— 【本项目的核心字段】 */
  freqRank: number;
  /** 真卷实际出现次数（用于展示"每 5 套卷必现"） */
  freqCount: number;
  /** freqRank <= 2104 → 'core2104' */
  tier: Tier;
  /** 数据源标注的六级词 */
  isCet6?: boolean;
  /** 数据源「分类」字段 */
  category?: string;
  /** 数据源「子分类」字段 */
  subCategory?: string;
  /** 所属分片序号 1..N，用于懒加载 */
  chunk: number;
  /** 关联真题例句数（用于 UI 标记"有真题例句"）。M0 例句管线未接，恒为 0 */
  sentenceCount: number;
  /** 合规留痕：'exam-data/CETVocabulary@<ref>' */
  source: string;
  /** 合规留痕：'CC BY-NC-SA 4.0' */
  license: string;
}

/** 轻量索引行：列式存储，用于首屏极速构建学习队列 */
export interface WordIndexRow {
  id: string;
  /** headword */
  w: string;
  /** freqRank */
  r: number;
  /** tier 枚举压缩：0=core2104 / 1=cet4 / 2=extended */
  t: 0 | 1 | 2;
  /** chunk */
  c: number;
  /** freqCount */
  f: number;
}

/** tier → 索引压缩码 */
export const TIER_CODE: Record<Tier, 0 | 1 | 2> = {
  core2104: 0,
  cet4: 1,
  extended: 2,
};

/** 索引压缩码 → tier */
export const TIER_FROM_CODE: Record<0 | 1 | 2, Tier> = {
  0: 'core2104',
  1: 'cet4',
  2: 'extended',
};

/** Word → 轻量索引行（首屏索引文件的生成与解析共用，避免两处逻辑漂移） */
export function toIndexRow(word: Word): WordIndexRow {
  return {
    id: word.id,
    w: word.headword,
    r: word.freqRank,
    t: TIER_CODE[word.tier],
    c: word.chunk,
    f: word.freqCount,
  };
}
