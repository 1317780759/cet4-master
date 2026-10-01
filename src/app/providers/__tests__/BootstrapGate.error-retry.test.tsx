import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { BootstrapGate } from '../BootstrapGate';
import { DbProvider } from '../DbProvider';
import { WordSourceProvider } from '@/data/WordSourceProvider';
import { createDb, type Cet4Database } from '@/data/db/db';
import { closeDatabase } from '@/data/db/migrations';
import { countWords } from '@/data/repos/wordRepo';
import type { WordSource } from '@/data/sources/WordSource';
import type { AttributionInfo, DataManifest } from '@/data/types';
import type { Word, WordIndexRow } from '@/domain/word/types';
import { toIndexRow } from '@/domain/word/types';

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

const WORDS: Word[] = [makeWord('w_alpha', 1), makeWord('w_beta', 2)];

class FlakyWordSource implements WordSource {
  readonly id = 'flaky';

  attribution: AttributionInfo = ATTRIBUTION;

  readonly manifest: DataManifest;

  manifestFails = 1;

  manifestCalls = 0;

  readonly chunkCalls: number[] = [];

  constructor() {
    this.manifest = {
      version: '2026.10.01.test',
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
    if (this.manifestCalls <= this.manifestFails) {
      throw new Error('network down (模拟离线)');
    }
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
let source: FlakyWordSource;

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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  if (!handle) throw new Error('render 未返回句柄');
  return handle;
}

beforeEach(async () => {
  db = createDb(`cet4-err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await db.open();
  source = new FlakyWordSource();
});

afterEach(async () => {
  await closeDatabase(db);
  await db.delete();
});

describe('BootstrapGate 失败与重试（QA 追加）', () => {
  it('manifest 失败 → 显示错误提示 + 重试按钮（非白屏）', async () => {
    await renderGate();

    await waitFor(() => expect(screen.getByText('词库加载失败')).toBeTruthy(), { timeout: 5_000 });
    const retryBtn = screen.getByRole('button', { name: '重试' });
    expect(retryBtn).toBeTruthy();
    // 非白屏：错误信息可见
    expect(screen.queryByText('READY')).toBeNull();
    // 未写入任何数据
    expect(await countWords(db)).toBe(0);
  });

  it('点击重试后恢复成功 → 渲染子内容', async () => {
    await renderGate();
    await waitFor(() => expect(screen.getByText('词库加载失败')).toBeTruthy(), { timeout: 5_000 });

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(screen.getByText('READY')).toBeTruthy(), { timeout: 5_000 });
    expect(await countWords(db)).toBe(WORDS.length);
    expect(source.chunkCalls).toEqual([1]);
  });
});
