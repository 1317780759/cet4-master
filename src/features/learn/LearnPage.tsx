import type { ReactNode } from 'react';
import { StudyRunner } from './StudyRunner';

/**
 * 背词页（最高频页面）。
 * 队列 = 到期复习 + 新词（严格按 freqRank 升序，词频优先）。
 */
export default function LearnPage(): ReactNode {
  return (
    <StudyRunner
      mode="learn"
      title="背单词"
      emptyTitle="暂时没有要背的词"
      emptyHint="当前档位的词可能都学过了 —— 可在首页调整词频档位，或先复习到期卡片。"
    />
  );
}
