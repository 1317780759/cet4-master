import { beforeEach, describe, expect, it } from 'vitest';
import type { Cet4Database } from '@/data/db/db';
import { buildSectionPlan } from '@/domain/exam/sectionPlan';
import { listWrong } from '@/data/repos/wrongRepo';
import { ExamSession, type ExamSessionDeps } from '@/services/examSession';
import { freshDb, makePaper, READING_COUNT, seedPaper } from './examFixture';

/**
 * 真题会话单测。
 *
 * 覆盖三条时间约定：ticks 累加、总时长取 plan.totalSec、audioState 恒 idle；
 * 以及两条产品口径：听力题不进批改范围、结果视图零总分。
 */

const NOW = 1_700_000_000_000;
const FIXED: ExamSessionDeps = { now: () => NOW, autosaveMs: 0 };

let db: Cet4Database;
let deps: ExamSessionDeps;

beforeEach(async () => {
  db = freshDb('session');
  deps = { ...FIXED, db };
  await seedPaper(db);
});

const plan = () => buildSectionPlan(makePaper());

describe('ExamSession · 开局', () => {
  it('写 attempt(ongoing) + 空答题卡，剩余时间取自 plan.totalSec', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);

    const attempt = await db.attempts.get(session.attemptId);
    expect(attempt?.status).toBe('ongoing');
    expect(attempt?.scoreScaleNote).toBe('objective-only');

    const sheet = await db.answerSheets.where('attemptId').equals(session.attemptId).first();
    // ★ 不写死 6000：必须等于启用板块建议用时之和
    expect(sheet?.remainingSec).toBe(plan().totalSec);
    expect(sheet?.remainingSec).toBe(plan().slots.reduce((s, x) => s + x.durationSec, 0));
    // 🎧 听力停用：音频状态恒 idle
    expect(sheet?.audioState).toBe('idle');
  });

  it('不限时模式 remainingSec 为 null', async () => {
    const session = await ExamSession.start(
      { paperId: 'TEST-2026-06-SET1', mode: 'practice', plan: plan(), untimed: true },
      deps,
    );
    expect(session.snapshot().remainingSec).toBeNull();
  });
});

describe('ExamSession · 作答与落盘', () => {
  it('作答写入内存并落盘，可恢复', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    await session.answer('R0', 'B');
    await session.answer('R1', 'A');
    await session.setCursor('R1');

    expect(session.snapshot().answers['R0']?.value).toBe('B');
    expect(session.snapshot().cursorQuestionId).toBe('R1');

    const restored = await ExamSession.resume(session.attemptId, deps);
    expect(restored?.snapshot().answers['R0']?.value).toBe('B');
    expect(restored?.snapshot().cursorQuestionId).toBe('R1');
  });

  it('节流：未到间隔不落盘，force 立即落盘', async () => {
    let clock = NOW;
    const slow: ExamSessionDeps = { db, now: () => clock, autosaveMs: 1000 };
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, slow);

    await session.answer('R0', 'B'); // 间隔未到 → 不落盘
    let sheet = await db.answerSheets.where('attemptId').equals(session.attemptId).first();
    expect(Object.keys(sheet?.answers ?? {})).toHaveLength(0);

    clock += 1500;
    await session.answer('R1', 'B'); // 超过间隔 → 落盘（含之前的作答）
    sheet = await db.answerSheets.where('attemptId').equals(session.attemptId).first();
    expect(Object.keys(sheet?.answers ?? {}).sort()).toEqual(['R0', 'R1']);
  });

  it('修改次数 revisions 累加', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    await session.answer('R0', 'A');
    await session.answer('R0', 'B');
    expect(session.snapshot().answers['R0']?.revisions).toBe(1);
  });
});

describe('ExamSession · 计时（ticks 累加）', () => {
  it('推进秒数：已用时增加、剩余减少', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    const total = plan().totalSec;

    const r1 = session.tick(60);
    expect(r1.remainingSec).toBe(total - 60);
    expect(session.snapshot().elapsedSec).toBe(60);

    session.tick(30);
    expect(session.snapshot().elapsedSec).toBe(90);
  });

  it('归零即 expired，且不会变成负数', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    const r = session.tick(plan().totalSec + 5000);
    expect(r.remainingSec).toBe(0);
    expect(r.expired).toBe(true);
  });

  it('ticks 不接受负数（防止误传时间戳）', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    expect(() => session.tick(-1)).toThrow();
  });
});

describe('ExamSession · 交卷', () => {
  it('★ 只批改启用板块的题：听力题不计入分母', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    for (let i = 0; i < READING_COUNT; i += 1) await session.answer(`R${i}`, 'B'); // 全对

    const { attempt, grade } = await session.submit('manual');
    // 听力有 2 道题（no 2/3），若被误纳分母应为 7 —— 这里必须是阅读题数
    expect(grade.objectiveTotal).toBe(READING_COUNT);
    expect(attempt.objectiveTotal).toBe(READING_COUNT);
    expect(attempt.status).toBe('submitted');
    expect(attempt.scoreScaleNote).toBe('objective-only');
  });

  it('答错的题进错题本，并回流生词', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    await session.answer('R0', 'A'); // 错（标准答案 B）
    await session.answer('R1', 'B'); // 对

    const { recycle } = await session.submit('manual');
    expect(recycle.wrongAdded).toBe(1);
    expect(recycle.vocabAdded).toBe(1); // R0 带 keyWordHints
    expect(await listWrong({}, db)).toHaveLength(1);
  });

  it('★ B6：标记存疑的错题不进错题本（全流程贯通）', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    await session.answer('R0', 'A'); // 错
    await session.markDoubtful('R0', true, 'answer-wrong');
    await session.answer('R1', 'A'); // 另一道普通错题

    const { grade, attempt } = await session.submit('manual');

    expect(grade.doubtfulProblemIds).toEqual(['R0']);
    expect(grade.wrongQuestionIds).toEqual(['R1']);
    expect(attempt.wrongQuestionIds).toEqual(['R1']);

    const rows = await listWrong({}, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.questionId).toBe('R1'); // ★ 存疑的 R0 不在其中
  });

  it('重复交卷不重复入错题本（防双击 / 自动交卷竞争）', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    await session.answer('R0', 'A');

    await session.submit('auto');
    const second = await session.submit('manual');

    expect(second.recycle.wrongAdded).toBe(0);
    expect(await listWrong({}, db)).toHaveLength(1);
  });

  it('★ 结果视图零总分：序列化后不含 425 / 710', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    await session.answer('R0', 'B');
    const { view } = await session.submit('manual');

    expect(JSON.stringify(view)).not.toMatch(/425/);
    expect(JSON.stringify(view)).not.toMatch(/710/);
    // 听力停用 → 结果页仍有占位卡（Q5 决策）
    expect(view.sections.some((s) => s.kind === 'disabled')).toBe(true);
  });

  it('已交卷的会话不能被 resume（防恢复半成品）', async () => {
    const session = await ExamSession.start({ paperId: 'TEST-2026-06-SET1', mode: 'mock', plan: plan() }, deps);
    await session.submit('manual');
    expect(await ExamSession.resume(session.attemptId, deps)).toBeUndefined();
  });
});
