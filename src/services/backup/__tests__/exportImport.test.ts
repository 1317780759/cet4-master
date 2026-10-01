import { beforeEach, describe, expect, it } from 'vitest';
import { type Cet4Database, MIRROR_STORES } from '@/data/db/db';
import type { ExamAttempt } from '@/domain/exam/types';
import { exportProgressJson, importProgressJson } from '@/services/backup/exportImport';
import { BACKUP_SCHEMA_VERSION, makeEnvelope, parseBackup } from '@/services/backup/schemaVersion';
import { freshDb } from '@/services/__tests__/examFixture';

/**
 * 导入导出单测 —— 核心是三件事：
 *   1. 只导出**用户进度区**（镜像区可由 public/data 重建，不该进备份）
 *   2. 版本契约必须在**任何写入之前**生效（坏了就整包拒绝，不能写半个备份）
 *   3. 自增主键表剥掉 id 后写入，不与本地既有行撞主键
 */

let db: Cet4Database;

const NOW = 1_700_000_000_000;

beforeEach(async () => {
  db = freshDb('backup');
  await db.wrongBook.bulkAdd([
    { wordId: 'w_a', source: 'practice', wrongCount: 1, firstWrongAt: NOW, lastWrongAt: NOW, enqueued: true, nextDue: NOW, resolved: false },
    { wordId: 'w_b', source: 'practice', wrongCount: 2, firstWrongAt: NOW, lastWrongAt: NOW, enqueued: false, nextDue: NOW, resolved: false },
  ]);
  await db.vocabBook.add({ wordId: 'w_a', addedAt: NOW, promoted: false });
  await db.dailyStats.put({ date: '2026-10-02', newLearned: 3, reviewed: 10, correct: 8, wrong: 2, minutes: 12, goalDone: false });
  const attempt: ExamAttempt = {
    id: 'att_1',
    paperId: 'P1',
    mode: 'mock',
    status: 'submitted',
    startedAt: NOW,
    elapsedSec: 600,
    objectiveScore: 4,
    objectiveTotal: 5,
    sectionScores: [],
    scoreScaleNote: 'objective-only',
    wrongQuestionIds: ['R0'],
    newWordIds: [],
  };
  await db.attempts.put(attempt);
});

describe('导出', () => {
  it('产出带版本契约的信封', async () => {
    const json = await exportProgressJson(db, NOW);
    const env = parseBackup<Record<string, unknown[]>>(json);

    expect(env.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(env.app).toBe('cet4-master');
    expect(env.exportedAt).toBe(NOW);
    expect(env.data.attempts).toHaveLength(1);
  });

  it('★ 只读导出用户进度区，镜像区（words/papers/…）不得入包', async () => {
    // 先塞一点镜像区数据，确认它不会被带出去
    await db.papers.put({
      id: 'P1', year: 2026, month: 6, setNo: 1, level: 'CET4', durationMin: 125,
      totalScore: 710, sectionMeta: [], provenance: 'derived', provenanceLabel: 'x',
      confidence: { level: 'low', hasTranscript: false, hasAudio: false, hasExplanation: false, answerCrossChecked: false, spotCheckRatio: 0, doubtCount: 0 },
    });

    const env = parseBackup<Record<string, unknown[]>>(await exportProgressJson(db, NOW));
    for (const store of MIRROR_STORES) {
      expect(env.data[store], `镜像区 ${store} 不应进备份`).toBeUndefined();
    }
    expect(env.data.attempts).toBeDefined();
  });
});

describe('版本契约（写入前拦截）', () => {
  it('拒绝非 JSON', () => {
    expect(() => parseBackup('not json at all')).toThrow(/不是合法的 JSON/);
  });

  it('拒绝未来版本（不能静默导入半个备份）', () => {
    const text = JSON.stringify({ ...makeEnvelope({}, NOW), schemaVersion: 99 });
    expect(() => parseBackup(text)).toThrow(/备份版本不受支持/);
  });

  it('拒绝其它 app 的备份', () => {
    const text = JSON.stringify({ ...makeEnvelope({}, NOW), app: 'some-other-app' });
    expect(() => parseBackup(text)).toThrow(/不是本站的备份文件/);
  });

  it('拒绝缺 data 字段', () => {
    const text = JSON.stringify({ schemaVersion: 1, app: 'cet4-master', exportedAt: NOW });
    expect(() => parseBackup(text)).toThrow(/缺少 data/);
  });

  it('导入失败时**不写入任何数据**', async () => {
    const target = freshDb('backup-guard');
    await expect(
      importProgressJson(JSON.stringify({ ...makeEnvelope({}, NOW), schemaVersion: 99 }), { instance: target }),
    ).rejects.toThrow();
    expect(await target.attempts.count()).toBe(0);
    expect(await target.wrongBook.count()).toBe(0);
  });
});

describe('导入', () => {
  it('merge（默认）：补齐缺失数据，且**不覆盖**本地既有进度', async () => {
    const target = freshDb('backup-merge');
    const json = await exportProgressJson(db, NOW);

    const first = await importProgressJson(json, { instance: target });
    expect(first.mode).toBe('merge');
    expect(first.imported.attempts).toBe(1);
    expect(first.imported.wrongBook).toBe(2);
    expect(await target.attempts.count()).toBe(1);

    // 本地把 attempt 改掉后再导一次 —— 不应被覆盖（merge 保留本地）
    await target.attempts.put({ ...(await target.attempts.get('att_1'))!, elapsedSec: 9999 });
    const second = await importProgressJson(json, { instance: target });
    expect(second.skipped).toBeGreaterThan(0);
    expect((await target.attempts.get('att_1'))?.elapsedSec).toBe(9999);
  });

  it('replace：覆盖本地（危险路径，需 UI 二次确认）', async () => {
    const target = freshDb('backup-replace');
    const json = await exportProgressJson(db, NOW);
    await target.attempts.put({
      id: 'att_1', paperId: 'P1', mode: 'mock', status: 'ongoing', startedAt: NOW,
      elapsedSec: 42, objectiveScore: 0, objectiveTotal: 0, sectionScores: [],
      scoreScaleNote: 'objective-only', wrongQuestionIds: [], newWordIds: [],
    });

    await importProgressJson(json, { instance: target, mode: 'replace' });
    expect((await target.attempts.get('att_1'))?.elapsedSec).toBe(600);
    expect((await target.attempts.get('att_1'))?.status).toBe('submitted');
  });

  it('★ 自增主键表剥掉 id 写入，不与本地既有行撞主键 / 不重复', async () => {
    const target = freshDb('backup-autoid');
    // 本地已有一条 wrongBook（会占用 id 1）
    await target.wrongBook.add({
      wordId: 'w_local', source: 'card', wrongCount: 5, firstWrongAt: NOW,
      lastWrongAt: NOW, enqueued: true, nextDue: NOW, resolved: false,
    });

    const json = await exportProgressJson(db, NOW);
    const report = await importProgressJson(json, { instance: target });

    expect(report.imported.wrongBook).toBe(2);
    // 本地 1 条 + 导入 2 条 = 3 条，且 id 未冲突（若沿用备份里的 id 会覆盖掉本地那条）
    expect(await target.wrongBook.count()).toBe(3);
    expect(await target.wrongBook.where('wordId').equals('w_local').count()).toBe(1);
  });

  it('往返一致：导出 → 导入 后数据量与源库相同', async () => {
    const target = freshDb('backup-roundtrip');
    const json = await exportProgressJson(db, NOW);
    await importProgressJson(json, { instance: target });

    expect(await target.attempts.count()).toBe(await db.attempts.count());
    expect(await target.wrongBook.count()).toBe(await db.wrongBook.count());
    expect(await target.vocabBook.count()).toBe(await db.vocabBook.count());
    expect(await target.dailyStats.count()).toBe(await db.dailyStats.count());
  });
});
