/**
 * 禁用词门禁回归 fixture（供 CI 门禁与单测共用）。
 *
 * ── 依赖方向（禁止倒置）─────────────────────────────────────────────
 *   `tests/fixtures/forbidden-words.ts`  import →  `scripts/forbidden-words.ts`
 *   ❌ 规则**不在**本文件定义：唯一的规则实现处是 `scripts/forbidden-words.ts`
 *      （CI 不得依赖测试目录）。本文件只保留「冻结样例」并再导出规则，
 *      使门禁脚本与单测永远引用同一份定义，杜绝正则两处漂移。
 * ────────────────────────────────────────────────────────────────────
 *
 * 背景：docs/03 §8.1–§8.2 与 docs/04 §5 对「禁用词门禁」做了实测，暴露两向风险 ——
 *   ① 漏放（假阴性）：`710 分预估` / `预估总分 710` 旧正则抓不到 → 补正向 `\s*` + 逆向检测；
 *   ② 误伤（假阳性）：放行否定式表述（`非官方发布`）必须先于收紧正则落地 → 加负向断言。
 *
 * 本文件**冻结样例**，任何门禁改动都必须让本 fixture 保持全绿，
 * 防止门禁在演进中被"放宽"到漏放，或被收紧到误伤我们自己的免责文案。
 *
 * 🔴 负向断言的残余缺口（docs/03 §9.1 / QA 实测）：`(?<![非未不])` 只豁免否定词与
 * 「官方」**紧邻**的形态。`未经官方发布` / `不属于官方发布` / `并非出自官方发布的材料` /
 * `算不上官方版本` 因否定词不紧邻，**仍会被拦**（见 B11–B14，标注为「已知限制」）。
 * 因此免责文案必须用**无邻接**写法（`并非官方渠道发布`），不要依赖否定语义识别 —— 见 P7–P10。
 * ⚠️ 门禁与 T2/页脚文案须**同批交付**，否则 M2 落地 T2 时该冲突会引爆。
 */

import type { ForbiddenSample } from '../../scripts/forbidden-words';

export * from '../../scripts/forbidden-words';

export const FORBIDDEN_SAMPLES: ForbiddenSample[] = [
  // ——— 应拦（正例）———
  { id: 'B1', text: '425分换算', expected: 'block', provenance: 'docs/03 §8.2', caughtBy: 'scoreForward' },
  { id: 'B2', text: '710 分预估', expected: 'block', provenance: 'docs/03 §8.2（有空格，旧正则漏检）', caughtBy: 'scoreForward' },
  { id: 'B3', text: '预估总分 710', expected: 'block', provenance: 'docs/03 §8.2（语序反转，须逆向检测）', caughtBy: 'scoreReverse' },
  { id: 'B4', text: '710分预估', expected: 'block', provenance: 'docs/04 §5.1（无空格）', caughtBy: 'scoreForward' },
  { id: 'B5', text: '不能折算为 425 分换算', expected: 'block', provenance: 'docs/04 §5.1（肯定换算语境）', caughtBy: 'scoreForward' },
  { id: 'B6', text: '官方真题', expected: 'block', provenance: 'docs/04 §5.4 G-2', caughtBy: 'negationOfficial' },
  { id: 'B7', text: '真题原卷', expected: 'block', provenance: 'docs/02 附录 B-16 禁用词表', caughtBy: 'rawPaper' },
  { id: 'B8', text: '权威真题', expected: 'block', provenance: 'docs/02 附录 B-16 禁用词表', caughtBy: 'authoritative' },
  { id: 'B9', text: '全真模考', expected: 'block', provenance: 'docs/02 附录 B-16 禁用词表', caughtBy: 'fullMock' },
  {
    id: 'B10',
    text: '不能折算为 710 分制',
    expected: 'block',
    provenance:
      '⚠️ 冲突锚点（G-7）：逆向检测必命中（折算…710）。docs/03 §8.1 因此把 T5 改写为无数字的 T5-v2 —— 本句不得进入 src/。',
    caughtBy: 'scoreReverse',
  },
  { id: 'B15', text: '710 分预测', expected: 'block', provenance: 'docs/03 §8.2（含「预测」语序，正向）', caughtBy: 'scoreForward' },
  { id: 'B16', text: '预测总分 425', expected: 'block', provenance: 'docs/03 §8.2（含「预测」语序，逆向）', caughtBy: 'scoreReverse' },

  // ——— 负向断言的已知边界（标注为「已知限制」，docs/03 §9.1）———
  // 下列 4 条虽含否定词，但否定词与「官方」**不紧邻** → 负向断言豁免不到 → 仍被拦。
  // 🔴 已知限制：这不是 bug 要修，而是**语料写法**要避 —— UI 文案不得使用「否定词与官方不紧邻」的写法，
  //    必须改用无邻接写法（见 P7–P10，如「并非官方渠道发布」）。
  { id: 'B11', text: '未经官方发布', expected: 'block', provenance: 'docs/03 §9.1（负向断言残余缺口 / 已知限制）', caughtBy: 'negationOfficial' },
  { id: 'B12', text: '不属于官方发布', expected: 'block', provenance: 'docs/03 §9.1（负向断言残余缺口 / 已知限制）', caughtBy: 'negationOfficial' },
  { id: 'B13', text: '并非出自官方发布的材料', expected: 'block', provenance: 'docs/03 §9.1（负向断言残余缺口 / 已知限制）', caughtBy: 'negationOfficial' },
  { id: 'B14', text: '算不上官方版本', expected: 'block', provenance: 'docs/03 §9.1（负向断言残余缺口 / 已知限制）', caughtBy: 'negationOfficial' },

  // ——— 应放行（反例）———
  { id: 'P1', text: '本页不显示 710 分制评分', expected: 'pass', provenance: 'docs/03 §8.2' },
  { id: 'P2', text: '不与任何官方计分口径对应', expected: 'pass', provenance: 'docs/03 §8.2 / T5-v2' },
  { id: 'P3', text: '非官方发布', expected: 'pass', provenance: 'docs/03 §9.4.1（负向断言放行；T2 改措辞系稳健性考量，非门禁强制）' },
  { id: 'P4', text: '非官方版', expected: 'pass', provenance: 'docs/03 §9.1（「非」紧邻「官方」→ 负向断言放行）' },
  { id: 'P5', text: '420分预估', expected: 'pass', provenance: 'docs/04 §5.1（非 425/710）' },
  { id: 'P7', text: '并非官方渠道发布', expected: 'pass', provenance: 'docs/03 §9.1 T2/页脚加固措辞（无邻接）' },
  { id: 'P8', text: '本站不提供标准答案，也不保证答案正确性', expected: 'pass', provenance: 'docs/03 §9' },
  {
    id: 'P9',
    text: '本套试卷为第三方公开整理版，并非官方渠道发布。由于官方从不公布试题与标准答案，本卷的题目、选项与答案未经核对，可能存在缺漏或误差；本套卷不含听力音频。',
    expected: 'pass',
    provenance: 'docs/03 §9.1 T2 全文（<ConfidenceBanner> 加固版）',
  },
  {
    id: 'P10',
    text: '本站试题内容来源于第三方公开整理，并非官方渠道发布，仅供个人学习使用',
    expected: 'pass',
    provenance: 'docs/03 §9.1 全局页脚加固版',
  },
  {
    id: 'P6',
    text: '本卷为第三方整理版，答案未经官方核对。成绩仅供练习参考，不代表真实四级水平，也不与任何官方计分口径对应。',
    expected: 'pass',
    provenance: 'docs/03 §8.1 T5-v2 全文',
  },
];
