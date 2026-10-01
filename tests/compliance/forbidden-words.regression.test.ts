import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectScanFiles,
  firstForbiddenMatch,
  GATE_PATTERNS,
  listFilesUnder,
  runGate,
  scanFile,
  SCAN_FILES,
  SCAN_ROOTS,
} from '../../scripts/forbidden-words';
import { FORBIDDEN_SAMPLES } from '../fixtures/forbidden-words';

/**
 * 禁用词门禁 · 回归测试
 *
 * 目的：把 docs/03 §8.2 / §9 与 docs/04 §5 的实测样例固化为可执行断言，
 * 让「应拦 / 应放行」在 CI 里被持续守住 —— 门禁既不能漏放（假阴性），
 * 也不能误伤我们自己的免责文案（假阳性）。
 *
 * ★ 规则与扫描**共用** `scripts/forbidden-words.ts` 的单一真源（依赖方向：tests → scripts）。
 */

/** vitest 以项目根为 cwd 运行 */
const REPO_ROOT = process.cwd();
/** 门禁 fixture 目录（必然含禁用词串，故必须落在扫描范围之外） */
const FIXTURE_DIR = path.resolve(REPO_ROOT, 'tests/fixtures');

function repoRelative(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

describe('禁用词门禁 · fixture 回归（docs/03 §8.2 / §9）', () => {
  it('应拦样例（正例）全部命中', () => {
    const missed = FORBIDDEN_SAMPLES.filter(
      (s) => s.expected === 'block' && firstForbiddenMatch(s.text) === null,
    ).map((s) => `${s.id} 「${s.text}」(${s.provenance})`);
    expect(missed).toEqual([]);
  });

  it('应放行样例（反例）全部不命中', () => {
    const falsePositives = FORBIDDEN_SAMPLES.filter(
      (s) => s.expected === 'pass' && firstForbiddenMatch(s.text) !== null,
    ).map((s) => `${s.id} 「${s.text}」→ 被 [${firstForbiddenMatch(s.text)}] 误伤`);
    expect(falsePositives).toEqual([]);
  });

  it('语序反转（预估总分 710）不可省逆向检测', () => {
    // 撤掉 scoreReverse 后必然漏放 —— 证明该模式不是冗余
    const withoutReverse: Record<string, RegExp> = {};
    for (const [name, re] of Object.entries(GATE_PATTERNS)) {
      if (name !== 'scoreReverse') withoutReverse[name] = re;
    }
    const stillCaught = Object.values(withoutReverse).some((re) => re.test('预估总分 710'));
    expect(stillCaught).toBe(false);
    expect(firstForbiddenMatch('预估总分 710')).toBe('scoreReverse');
  });
});

describe('禁用词门禁 · 扫描范围的结构性护栏（docs/03 §9.4.2 / §9.4.2b）', () => {
  it('守卫：fixture 目录必须落在扫描范围之外（关系式不变量，非字面量巧合）', () => {
    const rel = repoRelative(FIXTURE_DIR);
    const underRoot = SCAN_ROOTS.some((r) => rel === r || rel.startsWith(`${r}/`));
    const underFile = SCAN_FILES.some((f) => f === rel || f.startsWith(`${rel}/`));
    expect(
      underRoot || underFile,
      `门禁 fixture 位于 ${rel}/，它**必然包含禁用词串**（用例本体）。扩大扫描范围前必须先排除它，否则门禁会红在自己身上。`,
    ).toBe(false);
  });

  it('自证：fixture 目录确实含禁用词串（证明"含禁用词 + 在范围外"是有意设计）', () => {
    const files = listFilesUnder(FIXTURE_DIR);
    const hits = files.flatMap((file) => scanFile(file, REPO_ROOT));
    expect(hits.length).toBeGreaterThan(0);
  });

  it('扫描范围不含 docs/、tests/、scripts/（防止将来扩大范围重新引入自指）', () => {
    for (const segment of ['docs', 'tests', 'scripts']) {
      expect((SCAN_ROOTS as readonly string[]).includes(segment), `${segment} 不得作为扫描根`).toBe(false);
      expect(
        SCAN_FILES.some((f) => f === segment || f.startsWith(`${segment}/`)),
        `${segment} 不得出现在扫描文件范围`,
      ).toBe(false);
    }
    const offenders = collectScanFiles(REPO_ROOT).filter((file) =>
      /^(docs|tests|scripts)\//.test(repoRelative(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('禁用词门禁 · 对外可见产物扫描（src/** + public/data/ATTRIBUTION.md）', () => {
  it('对外可见产物零命中', () => {
    const { files, hits } = runGate(REPO_ROOT);
    expect(files.length).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});
