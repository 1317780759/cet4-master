import type { Word, WordIndexRow } from '@/domain/word/types';
import type { AttributionInfo, DataManifest } from '@/data/types';

/**
 * ★ 铁律 A3：词库读取一律经 `WordSource` 接口，禁止在业务层硬编码 JSON 结构。
 *
 * 换数据源（自建词频库 / 远程 CDN / 用户导入）只需替换本接口的实现，
 * `services/` 与 `features/` 一行都不用改 —— 这是 C5 合规与长期可维护性的共同要求。
 */
export interface WordSource {
  /** 数据源标识，例：'static-json' / 'remote-cdn' */
  readonly id: string;

  /** 合规溯源信息（会渲染到设置页与页脚） */
  readonly attribution: AttributionInfo;

  /** 读取 manifest.json（启动自检用，应 ≤ 几 KB） */
  fetchManifest(): Promise<DataManifest>;

  /** 读取轻量索引（Top 2104，列式） */
  fetchCoreIndex(): Promise<WordIndexRow[]>;

  /** 读取全量索引（后台预取） */
  fetchFullIndex(): Promise<WordIndexRow[]>;

  /**
   * 读取第 n 个分片（1-based）。
   * 实现方必须保证：抛错时调用方可安全重试（不留下半写状态由上层负责）。
   */
  fetchChunk(chunkIndex: number): Promise<Word[]>;

  /** 分片总数（来自已加载的 manifest；未加载前为 null） */
  chunkCount(): number | null;
}
