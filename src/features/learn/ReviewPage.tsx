import type { ReactNode } from 'react';
import { StudyRunner } from './StudyRunner';

/**
 * 复习页 —— 只取到期卡片（FSRS 调度），不引入新词。
 */
export default function ReviewPage(): ReactNode {
  return (
    <StudyRunner
      mode="review"
      title="复习"
      emptyTitle="暂无到期复习"
      emptyHint="FSRS 已把全部卡片安排在合适的时间点，到点了会在这里出现。先去背几个新词吧。"
      exitTo="/"
    />
  );
}
