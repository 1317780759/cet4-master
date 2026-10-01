# 数据体检报告

- manifest 版本：`2026.10.01.f2477692`
- 生成时间：2026-10-01T08:27:24.305Z
- 词条数：5278（core 2104）
- 分片：10 片 × ≤550 词，合计 2.39 MB
- 数据源：exam-data/CETVocabulary @ 7f21d0d · CC BY-NC-SA 4.0

| 结果 | 检查项 | 说明 |
|---|---|---|
| ✓ PASS | manifest 字段完整性 | 必需字段齐全 |
| ✓ PASS | 合规溯源（C5） | exam-data/CETVocabulary · CC BY-NC-SA 4.0 · 非商用标记正确 |
| ✓ PASS | 词条总数与 manifest 一致 | 实际 5278 / 声明 5278 |
| ✓ PASS | Word.id 无重复 | 5278 个唯一 id |
| ✓ PASS | headword 无重复（区分大小写） | 无重复 |
| ✓ PASS | freqRank 连续 1..N | 1..5278 连续 |
| ✓ PASS | 词频单调不增（排序正确） | 按词频降序排列 |
| ✓ PASS | tier 与 freqRank 一致 | 全部匹配 |
| ✓ PASS | chunk 字段与分片一致 | 全部匹配 |
| ✓ PASS | Top2104 边界条数 | coreCount=2104（期望 2104） |
| ✓ PASS | Top2104 词频边界（≥40 次） | rank 2104 = transmit（40 次）；rank 2105 = ancestor（39 次） |
| ✓ PASS | core2104 档位条数 | 2104 条 |
| ✓ PASS | Word.source / Word.license 非空（C5-B2） | 全部 5278 条均带溯源与许可 |
| ✓ PASS | 释义非空 | 全部词条均有释义 |
| ✓ PASS | core 索引行数 | 2104 行（manifest 声明 2104） |
| ✓ PASS | core 索引仅含 Top2104 | 范围正确 |
| ✓ PASS | core 索引 tier 压缩码合法 | 0/1/2 合法 |
| ✓ PASS | full 索引行数 | 5278 行（manifest 声明 5278） |
| ✓ PASS | full 索引 tier 压缩码合法 | 0/1/2 合法 |
| ✓ PASS | 分片 sha256 校验 | 10 片全部一致 |
| - SKIP | 例句覆盖率（目标 ≥90%） | 当前 0.0%（0/5278）—— 例句管线属于 M1，本轮跳过 |

结论：**PASS**（error 0 / warn 0）
