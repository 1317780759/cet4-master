import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db as defaultDb } from '@/data/db/db';
import { closeDatabase, openDatabase } from '@/data/db/migrations';
import { getCard, putCard } from '@/data/repos/cardRepo';
import { bulkPutWords } from '@/data/repos/wordRepo';
import { schedule } from '@/domain/fsrs/scheduler';
import { createCard, type ReviewCard } from '@/domain/fsrs/types';
import { DEFAULT_SETTINGS } from '@/domain/settings/types';
import type { Word } from '@/domain/word/types';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useStudyStore } from '@/store/useStudyStore';

/**
 * useStudyStore 集成测试（R-A1 / R-A2）。
 *
 * ★ 用 `defaultDb`（store 内部固定走 defaultDb）+ 真实 Dexie 读写；
 * ★ 时间用 `vi.spyOn(Date, 'now')` 控制（**不用** fake timers，避免干扰 Dexie 事务）。
 */

const NOW = new Date('2026-10-01T09:00:00+08:00').getTime();
let nowValue = NOW;

function makeWord(rank: number): Word {
  return {
    id: `w_${rank}`,
    headword: `word${rank}`,
    variants: [`word${rank}s`],
    senses: [{ pos: 'n', zh: `释义${rank}` }],
    freqRank: rank,
    freqCount: 1000 - rank,
    tier: rank <= 2104 ? 'core2104' : 'cet4',
    chunk: 1,
    sentenceCount: 0,
    source: 'test',
    license: 'CC BY-NC-SA 4.0',
  };
}

/**
 * 构造一张「已到期」的成熟复习卡（state = Review）：
 * 用连续 Good 推进出真实 FSRS 内部状态（stability / difficulty），再把 due 拨到过去使其到期。
 */
function matureDueCard(wordId: string, rank: number, now: number): ReviewCard {
  let cur = createCard(wordId, rank, now - 200 * 86_400_000);
  let at = cur.due;
  for (let i = 0; i < 4; i += 1) {
    cur = schedule(cur, 3, at).card;
    at = cur.due;
  }
  return { ...cur, due: now - 100_000 };
}

beforeEach(async () => {
  nowValue = NOW;
  vi.spyOn(Date, 'now').mockImplementation((): number => nowValue);
  await openDatabase(defaultDb);
  await Promise.all([
    defaultDb.cards.clear(),
    defaultDb.words.clear(),
    defaultDb.wrongBook.clear(),
    defaultDb.studyLogs.clear(),
    defaultDb.dailyStats.clear(),
  ]);
  await bulkPutWords(
    Array.from({ length: 30 }, (_, i) => makeWord(i + 1)),
    defaultDb,
  );
  // store 从 settings 镜像读取 dailyGoal / tier 等；置为可用默认值
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, dailyGoal: 1, tier: 'core2104' },
    hydrated: true,
  });
  useStudyStore.getState().reset();
});

afterEach(async () => {
  useStudyStore.getState().reset();
  vi.restoreAllMocks();
  await closeDatabase(defaultDb);
});

describe('useStudyStore · R-A1（队列暂空 ≠ 今日完成）', () => {
  it('队内 Again 重现卡未到期 → phase=waiting，pendingDueAt = 该卡 due，队内项 notBefore=due', async () => {
    await useStudyStore.getState().start('learn');
    let s = useStudyStore.getState();
    expect(s.phase).toBe('studying');
    expect(s.queue).toHaveLength(1);

    await useStudyStore.getState().rate('unknown'); // Again → 重现卡 notBefore = due
    s = useStudyStore.getState();

    const saved = await getCard('w_1', defaultDb);
    expect(saved).toBeTruthy();
    expect(saved?.due).toBeGreaterThan(NOW); // 当日重现落在未来

    expect(s.phase).toBe('waiting');
    expect(s.pendingCount).toBeGreaterThanOrEqual(1);
    expect(s.pendingDueAt).toBe(saved?.due);

    const requeued = s.queue[s.cursor];
    expect(requeued?.word.id).toBe('w_1');
    expect(requeued?.notBefore).toBe(saved?.due);
  });

  it('安全网：库中临期卡（30s 后到期）→ start(review) 进入 waiting 而非 empty', async () => {
    await putCard(
      { ...createCard('w_9', 9, NOW - 100_000), due: NOW + 30_000, state: 2, reps: 3 },
      defaultDb,
    );
    await useStudyStore.getState().start('review');
    const s = useStudyStore.getState();
    expect(s.phase).toBe('waiting');
    expect(s.pendingCount).toBe(1);
    expect(s.pendingDueAt).toBe(NOW + 30_000);
  });

  it('真完成：无卡且无临期卡 → start(review) 进入 empty', async () => {
    await useStudyStore.getState().start('review');
    expect(useStudyStore.getState().phase).toBe('empty');
  });
});

describe('useStudyStore · resume 门控', () => {
  it('resume(false) 未到点 → 保持 waiting', async () => {
    await useStudyStore.getState().start('learn');
    await useStudyStore.getState().rate('unknown');
    expect(useStudyStore.getState().phase).toBe('waiting');

    nowValue = NOW + 1_000; // 远早于 60s 重现点
    await useStudyStore.getState().resume(false);
    expect(useStudyStore.getState().phase).toBe('waiting');
  });

  it('resume(false) 到点 → studying', async () => {
    await useStudyStore.getState().start('learn');
    await useStudyStore.getState().rate('unknown');
    const dueAt = useStudyStore.getState().pendingDueAt ?? 0;

    nowValue = dueAt + 1;
    await useStudyStore.getState().resume(false);
    expect(useStudyStore.getState().phase).toBe('studying');
  });

  it('resume(force=true) 提前强制续 → studying', async () => {
    await useStudyStore.getState().start('learn');
    await useStudyStore.getState().rate('unknown');
    expect(useStudyStore.getState().phase).toBe('waiting');

    await useStudyStore.getState().resume(true);
    expect(useStudyStore.getState().phase).toBe('studying');
  });
});

describe('useStudyStore · B2（settle 不得提前进 waiting）', () => {
  it('dailyGoal=3：对首张 Again 后队首仍可答 → studying（守门测试）', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, dailyGoal: 3, tier: 'core2104' },
      hydrated: true,
    });
    await useStudyStore.getState().start('learn');
    let s = useStudyStore.getState();
    expect(s.queue).toHaveLength(3);
    expect(s.cursor).toBe(0);

    await useStudyStore.getState().rate('unknown'); // 首张 w_1 Again → 重现卡落队尾
    s = useStudyStore.getState();

    // 队首 w_2 可答 → 必须留在 studying，绝不因队尾门控卡提前进 waiting
    expect(s.phase).toBe('studying');
    expect(s.pendingCount).toBe(0);
    expect(s.pendingDueAt).toBeNull();
    // 游标未跳卡：下一张未答项仍是 w_2（而非被误吞后指向 w_3）
    expect(s.queue[s.cursor]?.word.id).toBe('w_2');
  });

  it('单卡 dailyGoal=1：全部待答项被门控 → waiting（B2 修复不得破坏原语义）', async () => {
    await useStudyStore.getState().start('learn'); // beforeEach 已置 dailyGoal=1
    expect(useStudyStore.getState().queue).toHaveLength(1);

    await useStudyStore.getState().rate('unknown');
    const s = useStudyStore.getState();
    expect(s.phase).toBe('waiting');
    expect(s.pendingCount).toBeGreaterThanOrEqual(1);
    expect(s.pendingDueAt).not.toBeNull();
  });
});

describe('useStudyStore · R-A2（同词连续 Again 不堆积）', () => {
  it('连续 Again + 强制续 → 待答区同一词至多 1 份', async () => {
    await useStudyStore.getState().start('learn');
    const wid = 'w_1';

    await useStudyStore.getState().rate('unknown');
    await useStudyStore.getState().resume(true);
    await useStudyStore.getState().rate('unknown');
    await useStudyStore.getState().resume(true);
    await useStudyStore.getState().rate('unknown');

    const s = useStudyStore.getState();
    const pending = s.queue.slice(s.cursor).filter((q) => q.word.id === wid);
    expect(pending.length).toBeLessThanOrEqual(1);
  });

  it('结构性去重：连续 Again ×4 后待答区 wordId 唯一', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, dailyGoal: 3, tier: 'core2104' },
      hydrated: true,
    });
    await useStudyStore.getState().start('learn');

    for (let i = 0; i < 4; i += 1) {
      if (useStudyStore.getState().phase === 'waiting') {
        await useStudyStore.getState().resume(true);
      }
      await useStudyStore.getState().rate('unknown');
    }

    const s = useStudyStore.getState();
    const ids = s.queue.slice(s.cursor).map((q) => q.word.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('useStudyStore · 5a（门控块按 notBefore 升序硬化）', () => {
  it('成熟卡先 Again、新卡后 Again → pendingDueAt 取最早（新卡），非队首（成熟卡）', async () => {
    await putCard(matureDueCard('w_30', 30, NOW), defaultDb);
    await useStudyStore.getState().start('learn'); // dailyGoal=1（beforeEach）→ 队列 [w_30(到期), w_1(新)]

    let s = useStudyStore.getState();
    expect(s.phase).toBe('studying');
    expect(s.queue.map((q) => q.word.id)).toEqual(['w_30', 'w_1']);

    await useStudyStore.getState().rate('unknown'); // w_30 Again → 成熟卡 +600000，落队尾
    expect(useStudyStore.getState().phase).toBe('studying'); // 队首 w_1 可答

    nowValue = NOW + 1_000;
    await useStudyStore.getState().rate('unknown'); // w_1 Again（新卡）→ +61000，落队尾
    s = useStudyStore.getState();

    const w1 = await getCard('w_1', defaultDb);
    const w30 = await getCard('w_30', defaultDb);

    // 进入 waiting，且 pendingDueAt = 最早到期的新卡（≈+61s），而非队首成熟卡（≈+600s）
    expect(s.phase).toBe('waiting');
    expect(s.pendingDueAt).toBe(w1?.due);
    expect(s.pendingDueAt).not.toBe(w30?.due);
    expect((s.pendingDueAt ?? 0) - nowValue).toBeLessThan(120_000);

    // 硬化后 queue[cursor] 即最早到期（新卡）
    expect(s.queue[s.cursor]?.word.id).toBe('w_1');

    // 待答块 notBefore 非降序
    const nbs = s.queue.slice(s.cursor).map((q) => q.notBefore ?? 0);
    for (let i = 1; i < nbs.length; i += 1) {
      expect(nbs[i]).toBeGreaterThanOrEqual(nbs[i - 1]);
    }

    // 到点 resume(false) → studying，队首仍是该新卡
    nowValue = s.pendingDueAt ?? 0;
    await useStudyStore.getState().resume(false);
    const s2 = useStudyStore.getState();
    expect(s2.phase).toBe('studying');
    expect(s2.queue[s2.cursor]?.word.id).toBe('w_1');
  });
});
