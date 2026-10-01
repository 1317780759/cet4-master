import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { BootstrapGate } from '../BootstrapGate';
import { DbProvider } from '../DbProvider';
import { WordSourceProvider } from '@/data/WordSourceProvider';
import { createDb, type Cet4Database } from '@/data/db/db';
import { closeDatabase } from '@/data/db/migrations';
import { countWords, localDataVersion, loadCoreIndex } from '@/data/repos/wordRepo';
import type { WordSource } from '@/data/sources/WordSource';
import type { AttributionInfo, DataManifest } from '@/data/types';
import type { Word, WordIndexRow } from '@/domain/word/types';
import { TIER_CODE, toIndexRow } from '@/domain/word/types';

/**
 * 首次加载 / 二次访问的端到端验证（jsdom + fake-indexeddb，不发真实网络请求）。
 * 对应 M0 验收标准：
 *   - 首次加载进度条走完
 *   - 第二次刷新**不再下载分片**（manifest 版本一致即跳过）
 */

const ATTRIBUTION: AttributionInfo = {
  sourceId: 'test-source',
  name: '测试词库',
  url: 'https://example.invalid',
  license: 'CC BY-NC-SA 4.0',
  licenseUrl: 'https://example.invalid/license',
  commercialUse: false,
  fetchedAt: '2026-10-01T00:00:00.000Z',
  upstreamRef: 'test',
};

function makeWord(id: string, freqRank: number): Word {
  return {
    id,
    headword: id.replace(/^w_/, ''),
    variants: [],
    senses: [{ pos: 'unknown', zh: '测试' }],
    freqRank,
    freqCount: 100 - freqRank,
    tier: freqRank <= 2104 ? 'core2104' : 'cet4',
    chunk: 1,
    sentenceCount: 0,
    source: 'test-source@test',
    license: 'CC BY-NC-SA 4.0',
  };
}

const WORDS: Word[] = [makeWord('w_alpha', 1), makeWord('w_beta', 2), makeWord('w_gamma', 3)];

class FakeWordSource implements WordSource {
  readonly id = 'fake';

  attribution: AttributionInfo = ATTRIBUTION;

  readonly manifest: DataManifest;

  /** 记录每次真正下载分片的调用 —— 用于断言「第二次不再下载」 */
  readonly chunkCalls: number[] = [];

  manifestCalls = 0;

  constructor(version: string) {
    this.manifest = {
      version,
      generatedAt: new Date().toISOString(),
      generator: 'test',
      wordCount: WORDS.length,
      coreCount: WORDS.length,
      coreBoundary: 2104,
      chunkSize: 550,
      chunkCount: 1,
      chunkFilePattern: 'words/chunk-{n}.json',
      indexes: {
        core: { file: 'words.index.core.json', sha256: 'x', count: WORDS.length },
        full: { file: 'words.index.full.json', sha256: 'x', count: WORDS.length },
      },
      chunks: [{ index: 1, file: 'words/chunk-001.json', sha256: 'x', count: WORDS.length, bytes: 1 }],
      sentences: { available: false, count: 0, coverage: 0, note: 'test' },
      attribution: ATTRIBUTION,
    };
  }

  async fetchManifest(): Promise<DataManifest> {
    this.manifestCalls += 1;
    return this.manifest;
  }

  async fetchCoreIndex(): Promise<WordIndexRow[]> {
    return WORDS.map(toIndexRow);
  }

  async fetchFullIndex(): Promise<WordIndexRow[]> {
    return WORDS.map(toIndexRow);
  }

  async fetchChunk(chunkIndex: number): Promise<Word[]> {
    this.chunkCalls.push(chunkIndex);
    return WORDS;
  }

  chunkCount(): number | null {
    return this.manifest.chunkCount;
  }
}

let db: Cet4Database;
let source: FakeWordSource;

/** 用 act 包裹渲染，让 DbProvider 的异步 setState 在断言前完成（避免 act 警告） */
async function renderGate(): Promise<ReturnType<typeof render>> {
  const tree: ReactNode = (
    <WordSourceProvider source={source}>
      <DbProvider instance={db}>
        <BootstrapGate>
          <div>READY</div>
        </BootstrapGate>
      </DbProvider>
    </WordSourceProvider>
  );
  let handle: ReturnType<typeof render> | null = null;
  await act(async () => {
    handle = render(tree);
  });
  // 再让一轮微任务/宏任务跑完，把 DbProvider 异步 open 的 setState 也收进 act
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  if (!handle) throw new Error('render 未返回句柄');
  return handle;
}

beforeEach(async () => {
  db = createDb(`cet4-boot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await db.open();
  source = new FakeWordSource('2026.10.01.test');
});

afterEach(async () => {
  await closeDatabase(db);
  await db.delete();
});

describe('BootstrapGate', () => {
  it('首次加载：进度门走完后渲染子内容，并灌入索引 + 首片', async () => {
    renderGate();

    await waitFor(() => expect(screen.getByText('READY')).toBeTruthy(), { timeout: 5_000 });

    expect(await countWords(db)).toBe(WORDS.length);
    expect((await loadCoreIndex(db)).length).toBe(WORDS.length);
    expect(await localDataVersion(db)).toBe('2026.10.01.test');
    expect(source.chunkCalls).toEqual([1]);
  });

  it('第二次访问：版本一致 → 跳过全部分片下载', async () => {
    const first = await renderGate();
    await waitFor(() => expect(screen.getByText('READY')).toBeTruthy(), { timeout: 5_000 });
    first.unmount();
    expect(source.chunkCalls).toEqual([1]);

    // 模拟刷新：组件重新挂载，但 IndexedDB 里的数据还在
    await renderGate();
    await waitFor(() => expect(screen.getByText('READY')).toBeTruthy(), { timeout: 5_000 });

    expect(source.chunkCalls).toEqual([1]); // 没有新增分片请求
    expect(await countWords(db)).toBe(WORDS.length);
  });

  it('manifest 版本变更 → 重新下载，且不丢用户进度', async () => {
    const first = await renderGate();
    await waitFor(() => expect(screen.getByText('READY')).toBeTruthy(), { timeout: 5_000 });
    first.unmount();

    // 用户进度：写一张卡片（属于 PROGRESS_STORES，重建镜像区时不得被清掉）
    await db.cards.put({
      wordId: 'w_alpha',
      due: 1,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      suspended: false,
      createdAt: 1,
      introsRank: 1,
    });

    // 发布新版本数据
    source = new FakeWordSource('2026.11.01.test');
    await renderGate();
    await waitFor(() => expect(screen.getByText('READY')).toBeTruthy(), { timeout: 5_000 });

    expect(source.chunkCalls).toEqual([1]);
    expect(await localDataVersion(db)).toBe('2026.11.01.test');
    expect(await countWords(db)).toBe(WORDS.length);
    // ★ 关键断言：换了词库版本，用户进度仍在
    expect(await db.cards.count()).toBe(1);
  });

  it('索引压缩码与 tier 一致', () => {
    for (const word of WORDS) {
      expect(TIER_CODE[word.tier]).toBe(0);
    }
  });
});
