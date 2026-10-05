# 增量 PRD v2 —— CET-4 词汇 PWA 手机端优化

| 项 | 内容 |
|---|---|
| 文档名 | PRD-optimize-v2.md |
| 撰写人 | 许清楚（产品经理） |
| 日期 | 2026-10-05 |
| 版本 | v2（增量，基于已上线 v1） |
| 项目 | CET-4 词汇学习 PWA（`C:\Users\13177\Desktop\yy`） |
| 线上地址 | https://1317780759.github.io/cet4-master/ |
| 技术栈 | Vite + React + Tailwind v4 + Dexie/IndexedDB（**纯前端 PWA，无后端**） |
| 目标平台 | **手机浏览器 / 添加到主屏**（用户真实使用场景） |
| 范围 | 只写文档，**不改业务代码**。本文所有「现状」均为实际读码 + 读数据得出，附文件路径与行号 |

> 本文档处理用户提出的 5 条优化需求：
> 1. 背词翻卡要有按钮 + 重复播放语音按钮 + 单词下给音标
> 2. 单词收藏按钮找不到，请补全
> 3. 背词顺序可调整，不要从头开始，想要随机
> 4. 测试卷数量可以增加点
> 5. 加一个四级英语翻译训练功能（功能详细点，功能选择交给用户拍板）

---

## 一、现状事实基线（代码勘查结论）

> 以下每条都是**读码 + 读数据实测**得出的结论，是后续所有规格的事实依据。
> 数据来源：`src/**`、`public/data/**`、`scripts/**`，实测脚本统计 5278 个词条字段覆盖率。

### 1.1 需求 1 相关：翻卡 / 语音 / 音标

| # | 事实 | 证据 |
|---|---|---|
| F1.1 | **翻卡按钮其实存在**，但未翻卡时卡片下方渲染 `<Button block size="lg">显示释义（Space）</Button>`（`h-12` = 48px，触控达标） | `src/features/learn/StudyRunner.tsx:241-247` |
| F1.2 | 真正的问题：① 按钮文案带「（Space）」，手机上无意义；② 按钮在卡片**下方**，长卡片时需滚动才够得着；③ 卡片**整块可点**（`role="button"` + `tabIndex=0` + Enter 翻卡），手机上极易误触，且与「点例句里的单词跳转」手势冲突 | `src/ui/word/WordCard.tsx:41-59` |
| F1.3 | 翻卡后**没有任何重播发音按钮**：底部操作区被 `RatingBar` 整体替换，原翻卡按钮消失 | `StudyRunner.tsx:241-247` |
| F1.4 | 重播发音的唯一入口是音标旁的 🔊 小图标，尺寸 **`h-6 w-6` = 24px**，远低于 iOS/Android 44px 触控标准 | `src/ui/word/Phonetic.tsx:41-52` |
| F1.5 | 卡片本体在翻卡后仍可点击，点击 = 发音（`handleReveal` 的 else 分支），这是一个**用户发现不了的隐藏行为** | `StudyRunner.tsx:115-119` |
| F1.6 | `WordCard` 的 `onPlay` 签名是 `(accent: 'uk' \| 'us') => void`，但 `StudyRunner` 传入的回调**忽略 accent**，永远按设置口音朗读 —— 音标区「英/美」两个喇叭点了没区别 | `WordCard.tsx:20` vs `StudyRunner.tsx:237` |
| F1.7 | **音标字段存在但数据全空**：类型 `phoneticUk?` / `phoneticUs?` 已定义；`Phonetic` 在两者皆空时 `return null`（优雅隐藏）；实测 **5278 词中 `phoneticUk` 覆盖率 = 0，`phoneticUs` 覆盖率 = 0** | `src/domain/word/types.ts:44-45`；`src/ui/word/Phonetic.tsx:19`；实测统计 |
| F1.8 | 词库构建脚本 `scripts/build-wordbank.ts` 不产出音标；`public/data/manifest.json` 也没有音标相关条目 | `scripts/build-wordbank.ts`、`public/data/manifest.json` |
| F1.9 | 键盘快捷键由 `useKeyboard` 统一注册（Space 翻卡、←↓→ 评级），`RatingBar` 上已有 `min-h-14`（56px）触控达标 + `keyHint` 标注 | `StudyRunner.tsx:121-128`、`src/ui/word/RatingBar.tsx:25-47,67` |
| F1.10 | TTS 能力完备：`useTts` + `WebSpeechProvider` / `YoudaoProvider`，有「首次手势解锁」机制，设置页可选「系统合成 / 有道 / 关闭」+英/美口音 | `src/hooks/useTts.ts`、`src/services/speech/*`、`SettingsPage.tsx:156-197` |

> **结论**：需求 1 的真问题不是"没有按钮"，而是 **① 音标数据一条都没有（这是主要工作量）② 翻卡后失去发音入口 ③ 24px 喇叭点不中 ④ 整卡可点导致误触**。

### 1.2 需求 2 相关：收藏（生词本）

| # | 事实 | 证据 |
|---|---|---|
| F2.1 | 收藏的数据层**已完备**：`vocabBook` 表（`++id, wordId, addedAt, promoted`），repo 提供 `addVocab`（幂等）/ `findVocab` / `removeVocab` / `listVocab` / `countVocab` / `promoteVocab` | `src/data/db/db.ts:60`、`src/data/repos/vocabRepo.ts` |
| F2.2 | 收藏入口**只存在于两个页面**：查词页 `SearchPage` 和单词详情页 `WordDetailPage`。**背词页（`StudyRunner` / `WordCard`）完全没有收藏入口** → 用户"找不到"属实 | `src/features/search/SearchPage.tsx:63-69,118-125`；`src/features/word-detail/WordDetailPage.tsx:64-73,176-178`；`src/ui/word/WordCard.tsx`（无相关 props） |
| F2.3 | 三处实现**已出现漂移**：`SearchPage.toggleStar` 是**单向的**（`if (starred.has(word.id)) return;` —— 已收藏就点不动，无法取消）；`WordDetailPage.toggleVocab` 是**完整的增删 toggle** | `SearchPage.tsx:65` vs `WordDetailPage.tsx:64-73` |
| F2.4 | 查词页 ★/☆ 按钮触控区约 24–28px（`px-2 text-lg`），手机上难命中 | `SearchPage.tsx:118-125` |
| F2.5 | 收藏后**有地方看**：词本页 `WordBooksPage` 有「错词本 / 生词本」双 Tab，但**默认 Tab 是 `wrong`（错词本）**，用户收藏后切过去第一眼看不到生词 | `src/features/books/WordBooksPage.tsx:23-40` |
| F2.6 | 生词本已有下游消费：测验页词池来源 `QuizPoolSource` 含 `'vocab'`（考你主动收藏的生词） | `src/services/quizPool.ts:20`、`QuizPage.tsx:33-39` |
| F2.7 | 收藏**不进 FSRS 队列**、不影响学习队列（`addVocab` 只写 `vocabBook`） | `vocabRepo.ts:18-33` |

### 1.3 需求 3 相关：出词顺序

| # | 事实 | 证据 |
|---|---|---|
| F3.1 | 现有开关是**布尔量** `freqOrdering`，默认 `true` | `src/domain/settings/types.ts:26,55` |
| F3.2 | 设置页只有这一句话开关「按词频顺序出词 / 关闭则随机出词」 | `src/features/settings/SettingsPage.tsx:212-217` |
| F3.3 | **"从头开始"的成因已定位**：`newWordCandidates` 把候选按 `freqRank` 升序排序，`freqOrdering=true` 时直接 `candidates.slice(0, limit)` → **永远取 freqRank 最小的未学词**（即 rank=1,2,3…），用户每天开局都是同一批高频开头词 | `src/domain/word/selector.ts:39-52,60-71` |
| F3.4 | `freqOrdering=false` 会走 `shuffle()`（Fisher–Yates，可注入 `random` 便于单测）后取前 N，**随机实现已存在且正确** | `selector.ts:66-83` |
| F3.5 | 但**随机只作用于"新词"部分**：队列 = `dueCards`（到期复习）在前 + `newRows`（新词）在后；复习卡顺序由 `listDue` 决定，不可随机（FSRS 语义） | `src/services/studySession.ts:91-125` |
| F3.6 | 候选池**受已加载分片限制**：首屏只灌 `chunk 1`（550 词），其余靠 `cacheWarmer` 空闲预取；而 `selectionRows` 读 `instance.words` 全表 → 分片没预取完时随机池远小于 5278 | `src/data/loader/chunkLoader.ts:55-98`；`studySession.ts:59-69` |
| F3.7 | 顺序策略的**数据基础已具备**：错词在 `wrongBook`（含 `wrongCount` / `nextDue` / `resolved`），掌握状态在 `cards`（`state` / `lapses` / `suspended`），完全够做「未掌握优先」「错词优先」 | `db.ts:58-59` |
| F3.8 | 设置页已有 `Segmented` 组件（档位、口音、主题都在用），改成多选顺序控件几乎零成本 | `SettingsPage.tsx:110-116,170-178,235-248` |

### 1.4 需求 4 相关：测试卷数量

| # | 事实 | 证据 |
|---|---|---|
| F4.1 | **全站只有 1 套卷**：`public/data/papers/index.json` 的 `papers` 数组只有 `derived-2026-06-set1`，`questionCount: 12`，`provenance: derived`，`confidenceLevel: medium` | `public/data/papers/index.json:6-17` |
| F4.2 | 该卷实测 **12 题**：`essay×1`(no.1) + `choice×10`(no.27–36) + `translation×1`(no.37)；共 13 KB | 实测解析 `public/data/papers/derived-2026-06-set1.json` |
| F4.3 | 卷子是**缩水版**：`sectionMeta` 声明 reading 区间 27–36（10 题），而考试规格是 **30 题**（选词填空 10 + 长篇匹配 10 + 仔细阅读 10）；听力区间 2–26 在题库里**一道题都没有** | `derived-2026-06-set1.json` 的 `sectionMeta` vs `src/domain/exam/types.ts:277-306`（`DerivedSpec`） |
| F4.4 | **题型已定义但 0 题**：`banked-cloze`（选词填空）、`matching`（长篇匹配）在 `QuestionKind` 里存在，当前题库中数量均为 0 → 这是"题型扩充"的现成抓手 | `src/domain/exam/types.ts:119-131` |
| F4.5 | 听力被**结构性停用**：`DEFAULT_DISABLED_SECTIONS = ['listening']`，`questionsInPlan` 按 plan 区间过滤题目。恢复听力只需改这一个常量 | `src/domain/exam/sectionPlan.ts:61,134-141` |
| F4.6 | **测试卷是静态 JSON + 构建脚本产出，不是运行时生成**。管线：`scripts/data/authored/papers/*.json`（自撰，入库）→ `scripts/build-papers.ts`（读 authored + raw 两目录 → id 冲突检测 → `verifyPapers` 门禁 → 产出 `public/data/papers/<id>.json` + `index.json`）。命令 `pnpm run data:papers` | `scripts/build-papers.ts:26-110`、`package.json` scripts |
| F4.7 | 门禁规则已很硬（新增卷必须全过）：`NO_SECTIONS` / `DUP_ORDER` / `BAD_RANGE` / `RANGE_OVERLAP` / `DUP_QNO` / `QNO_OUT_OF_RANGE` / `MISSING_ANSWER` / `A6_AUDIO_FIELD`（铁律：不得携带音频字段）/ `BAD_PROVENANCE` / `NO_LABEL` / `NO_CONFIDENCE` / `FORBIDDEN_WORD`（自撰内容命中禁用词） | `scripts/verify-papers.ts:59-198` |
| F4.8 | 加载是**按套懒加载**：列表页只读 `index.json`（≈0.4 KB），点进某套才下载整套 JSON | `src/features/papers/PapersPage.tsx:26-46,148`；`src/data/loader/paperLoader.ts` |
| F4.9 | 另有「四选一测验」页（`/quiz`），题数选项是 **10 / 20 / 30**，词池来源 5 种（已学 / 到期 / 错题 / 生词 / 词频） | `src/features/quiz/QuizPage.tsx:33-39,213-227` |
| F4.10 | 结果面板**结构性不给总分**（`ExamResultView` 无总分字段），只给客观题正确率 + 主观题自评档位 —— 这是刻意设计，不要改 | `src/features/mock/ExamResultPanel.tsx:8-16` |

> **"测试卷"歧义**：用户说的可能是「真题套卷」（列表页显示"1 套"）也可能是「测验题量」。本文**两者都给方案**，并列入拍板项让用户确认。

### 1.5 需求 5 相关：翻译训练的现有地基

| # | 事实 | 证据 |
|---|---|---|
| F5.1 | 翻译题型**已存在**：`QuestionKind = 'translation'`（汉译英段落），当前每套卷 1 题（no.37），有 `stem`（中文段落）+ `rubric`（评分参考，如"注意'近年来'用现在完成时"） | `src/domain/exam/types.ts:128-129`；`derived-2026-06-set1.json` 的 `T1` |
| F5.2 | **翻译题不做自动判分**：`grader.ts` 明确把 `essay` / `translation` 排除出客观题分母；结果面板只展示 `selfScore`（自评档位），无对错 | `src/domain/exam/grader.ts:47`；`src/domain/exam/result.ts:144-147` |
| F5.3 | 主观题作答 UI 已有：`textarea`（翻译 5 行 / 写作 8 行）+ 标记待定 + 答案存疑 | `src/features/mock/ExamRunner.tsx:295-322` |
| F5.4 | **没有独立翻译训练页**，路由表里没有 `/translation`；底部 6 个 Tab 也没有翻译入口 | `src/router.tsx:29-51`；`src/app/layout/BottomTabBar.tsx:60-67` |
| F5.5 | **没有任何翻译题库**，也没有例句语料：`manifest.json` 的 `sentences: { available: false, count: 0, coverage: 0 }`，全库 `sentenceCount` 恒为 0 | `public/data/manifest.json` |
| F5.6 | AI 能力位是**预留但恒关**的：`UserSettings.aiEnabled` 注释写着「MVP 恒为 false（C3 约束）」，设置页无 AI 配置 UI | `src/domain/settings/types.ts:28-29,56` |
| F5.7 | 项目是**纯前端 PWA，零后端**，全站数据落 IndexedDB，进度可导出/导入 JSON（含设置） | `src/services/backup/exportImport.ts` |
| F5.8 | 合规铁律已成型：不复制真题原文、音频零入库、来源标注（A7）+ 置信度标注、killSwitch 可整站下线。任何新增语料必须遵守 | `scripts/build-papers.ts:8-15`、`scripts/verify-papers.ts`、`public/data/ATTRIBUTION.md` |

---

## 二、需求 1：翻卡按钮 + 重播语音 + 音标

### 2.1 用户故事

- 作为手机用户，我想**点一个大按钮翻卡**，而不是在卡片上乱点 / 按空格，这样单手也能稳定操作。
- 作为手机用户，我想**随时重播单词发音**，这样没听清可以再来一遍。
- 作为手机用户，我想在**单词下方看到音标**，这样我知道它怎么读。

### 2.2 手机端布局规格

自上而下（背词页 `/learn` 与 `/review` 共用 `StudyRunner`）：

```
┌ 顶部条：标题 · 已完成 x/y · 退出 ────────────┐
├ Progress（本组进度）────────────────────────┤
├ WordCard ──────────────────────────────────┤
│  [新词/复习] [档位]              词频 #123 │
│                                       ★  │ ← 新增收藏按钮 44×44（需求 2）
│            a b a n d o n                │ ← headword 大字
│      英 /əˈbændən/ 🔊  美 /əˈbændən/ 🔊   │ ← 音标行（数据补齐后）+ 44px 喇叭
│                                           │
│  【未翻卡】「想一想意思，然后点下面的按钮」 │
│  【已翻卡】释义 + 真卷词频 + 真题例句       │
└───────────────────────────────────────────┘
┌ 底部操作区（48px 起，随卡片下方，不吸底）──┤
│ 【未翻卡】[      翻 卡 看 释 义      ]      │ ← block, h-12
│ 【已翻卡】[ 🔊 重播 ] [ ★ 收藏 ]           │ ← 两枚 h-12，等宽
│          [ 不认识 ] [ 模糊 ] [ 认识 ]      │ ← RatingBar（min-h-14 已有）
└───────────────────────────────────────────┘
```

### 2.3 详细规格

#### R1-A 翻卡按钮（P0）

| 项 | 规格 |
|---|---|
| 位置 | 卡片正下方主行动区，与 `RatingBar` 同槽位互斥（未翻卡 = 翻卡按钮，已翻卡 = 重播+收藏，再下是 RatingBar） |
| 尺寸 | `min-h-12`（48px）≥ 44px 触控标准；`block`（满宽）；`size="lg"` |
| 文案 | 「翻卡看释义」（**去掉「（Space）」**，手机无键盘；桌面端另见 R1-D） |
| 翻卡后状态 | 按钮消失，替换为「🔊 重播」+「★ 收藏」；卡片**整块不再可点**（见 R1-C）；释义区淡入（`transition-opacity`，≤150ms，不做 3D 翻转动画——手机端动画会拖慢连续背词节奏） |
| 翻卡方向 | 单向，翻卡后不可收回（与现有 `revealed` 语义一致，不动 store） |
| 自动发音 | 保持不变：翻卡时若 `autoPlay` 开启则朗读一次（`StudyRunner.tsx:90-95`）。**重播按钮 = 手动再触发一次，与自动发音互不干扰** |

#### R1-B 重播语音按钮（P0）

| 项 | 规格 |
|---|---|
| 位置 | 翻卡后底部操作区左侧（P0）；音标行内的英/美 🔊 保留作为「选口音播」（P1） |
| 尺寸 | `h-12`（48px）；图标 + 文字「重播」 |
| 行为 | `tts.speak(word.headword)`，按设置口音；连点不叠加（先 `tts.cancel()` 再 speak） |
| 未解锁降级 | 首次手势前浏览器可能静音；按钮照常显示，点击即视为手势解锁（`useTts` 已内建） |
| TTS 关闭时 | `ttsProvider === 'off'` → 按钮 `disabled` + 下方一行小字「已在设置里关闭发音」 |
| 音标行喇叭（P1） | 把 `Phonetic.tsx:48` 的 `h-6 w-6` 改为 `h-11 w-11`（44px）并补 `aria-label`；同时修复 F1.6 —— `onPlay` 的 `accent` 参数必须真正生效（`StudyRunner` 传 `(accent) => provider.speak(headword, { accent })`） |

#### R1-C 移除整卡点击（P0，防误触）

- `WordCard.tsx:41-59` 的 `role="button"` / `tabIndex` / 卡片级 `onClick` / `onKeyDown` **移除**。
- 但例句里的单词仍需可点跳转（`ExamSentenceList` 的 `onWordClick`）→ 只删卡片根节点的手势，保留子元素按钮。
- 未翻卡提示文案改为：「想一想它的意思，然后点下面的按钮」（去掉「或按 Space」；桌面端由 `useKeyboard` 自动判断 —— 可用 `matchMedia('(hover: hover)')` 在桌面端补一行「或按 Space」）。

#### R1-D 键盘快捷键（保留，P0）

- **全部保留**：Space/Enter 翻卡、←（模糊）/ ↓（不认识）/ →（认识）评级、Esc 退出 —— 桌面端体验零退化。
- 新增快捷键：`R` 重播发音（与 Space 区分，避免手滑按空格同时翻卡+发音）。
- 所有新按钮必须有 `aria-label`（「重播单词发音」「收藏到生词本」）。

#### R1-E 音标（P0，主要工作量在数据不在 UI）

**现状**：字段和组件都就位，但 5278 词音标数据 = 0 条（F1.7/F1.8）。所以这一条的本质是**补数据管线**。

| 项 | 规格 |
|---|---|
| UI | 零改动（`WordCard.tsx:75-81` 已渲染 `<Phonetic>`，数据一到就自动显示）。仅需把喇叭放大到 44px（R1-B） |
| 数据来源 | 新增 `scripts/build-phonetics.ts`：按 `headword`（含 `variants`）从**允许商用的公开音标数据源**匹配英/美音标（候选：Wiktionary dump / CMUdict / ECDICT 等）。**必须核对许可证**（CC0 / CC BY / CC BY-SA / MIT），并参考 `exam-data/CETVocabulary` 的 `CC BY-NC-SA 4.0` 先例，把新数据源追加进 `public/data/ATTRIBUTION.md` 与 `docs/依赖许可记录.md` |
| 产物 | 独立文件 `public/data/phonetics/phonetics.json`（≈5278 条 × ~45 B ≈ **240–300 KB**，可按 10 片随 chunk 一起懒加载），**不要写进 `words/*.json`** —— 避免动 `manifest.json` 里 10 个 chunk 的 `sha256` 与 `wordCount`，防止触发全库重建、用户进度区虽不受影响但白白重灌 2.5 MB |
| 存储 | 新增 Dexie 表 `phonetics: 'id'`（`id` = wordId）。属于**只读镜像区** `MIRROR_STORES`，可与词库一起重建 |
| 覆盖率目标 | **核心 2104 词 ≥ 95%**，全量 5278 词 ≥ 85%（拍板项 Q8：可只先补核心） |
| 缺失降级 | 匹配不到时**不显示占位**（沿用 `Phonetic.tsx:19` 的 `return null`），并在脚本报告里列出未命中词表供人工补 |
| 门禁 | 新增 `scripts/verify-phonetics.ts`：① IPA 字符集白名单校验（防乱码入库）② 覆盖率低于阈值直接 fail ③ 单条长度上限（≤40 字符）④ 英音缺失允许美音兜底，反之亦然 |
| 合规 | 音标本身属事实性标注，但**数据源的选取与署名必须留痕**；若某数据源协议与本项目 `CC BY-NC-SA 4.0` 不兼容，改用兼容源或只取 CC0 部分 |

### 2.4 不做的事

- 不做 3D 翻卡动画（手机端拖慢节奏、且增加包体）。
- 不在背词页加例句跟读录音（超出范围）。
- 音标**不进** `words` 镜像，不改 `manifest.json` 的 chunk 哈希。

---

## 三、需求 2：收藏按钮补全

### 3.1 用户故事

- 作为手机用户，我在背词时遇到想重点记的词，想**当场一键收藏**，不用退出去查词页找。
- 作为手机用户，我收藏完想**立刻看到反馈**，并且知道去哪能找到它们。

### 3.2 规格

#### R2-A 按钮形态与位置（P0）

| 项 | 规格 |
|---|---|
| 主入口 | `WordCard` **右上角** ★/☆ 按钮（未翻卡时也要在，用户可能凭读音就想收藏） |
| 尺寸 | `h-11 w-11`（44×44），图标 20px，`aria-label` 动态：未收藏 `把 abandon 加入生词本` / 已收藏 `abandon 已在生词本，点击移出` |
| 视觉 | 未收藏：空心 ☆（描边 `slate-400`）；已收藏：实心 ★（`amber-500`）+ 0.15s 缩放回弹（`scale-110 → scale-100`） |
| 次入口 | 翻卡后底部操作区右侧「★ 收藏 / ★ 已收藏」按钮（48px），与「🔊 重播」并排。两处状态**共享同一份 state**，点击任一处同步 |
| 正反两面 | **必须可取消**（修复 F2.3 的单向 bug），点击已收藏 → `removeVocab` |

#### R2-B 状态同步（P0）

```ts
// 新增 src/hooks/useVocabToggle.ts —— 三处共用，消除漂移
useVocabToggle(wordId) => { inVocab, toggle, pending }
```

- 挂载时 `findVocab(wordId)` 初始化；乐观更新 → 写库 → 失败回滚并提示。
- **`SearchPage` / `WordDetailPage` / `WordCard` 三处统一改用此 hook**，`SearchPage` 的单向逻辑一并修正（P0，`SearchPage.tsx:63-69`）。
- 背词页切换下一词时重新 `findVocab`（不缓存到全局，避免跨词串状态）。

#### R2-C 收藏后的可见反馈（P0）

1. 按钮本身变实心（即时）。
2. 底部 Toast（`role="status"`，2s 自动消失，位置在底部 Tab 栏之上 16px，**不遮挡 RatingBar**）：
   - 加入：「已加入生词本 · 到「词本」查看」
   - 移出：「已移出生词本」
3. Toast 上带一个「去看」文字按钮 → `/books?tab=vocab`。

#### R2-D 收藏后的去处（P1）

- `WordBooksPage` 支持 URL 参数 `?tab=vocab` 直达生词本（当前默认 Tab 是 `wrong`，见 F2.5）；并记住用户上次停留的 Tab（存 `meta`）。
- 生词本列表支持按加入时间倒序（已经是 `orderBy('addedAt').reverse()`）+ 显示「收藏于 3 天前」。
- 生词本条目可一键「加入学习队列」（`promoteVocab` 已实现，目前无 UI）。

#### R2-E 边界（明确不做）

- 收藏**不改变**学习队列与 FSRS 排期（只是打标）。
- 收藏**不做**批量/全选。
- 收藏数据随进度导出一并走（`exportImport` 需确认覆盖 `vocabBook`；若未覆盖则补，P1）。

---

## 四、需求 3：背词顺序可调整（随机 / 词频 / 未掌握优先 / 错词优先）

### 4.1 用户故事

- 作为用户，我不想每次都从 `the / be / of` 这批开头词背起，想要**随机点**。
- 作为用户，我想在考前把时间花在**没掌握的和反复错的词**上。

### 4.2 提供的排序策略

| 策略 | 键 | 语义 | 数据依据 |
|---|---|---|---|
| 随机 | `random` | 在候选池内 Fisher–Yates 洗牌后取前 N | `selector.shuffle`（已实现，F3.4） |
| 词频 | `freq` | 严格 `freqRank` 升序（**现状默认**，即"从头开始"） | `newWordCandidates` 排序（F3.3） |
| 未掌握优先 | `weak` | `cards` 中 `state ∈ {0,1}`（新/学习中）或 `lapses ≥ 1` 的词排前，其余按词频 | `cards.state` / `cards.lapses` |
| 错词优先 | `wrong` | `wrongBook` 中 `resolved !== true` 的词按 `wrongCount` 降序排前，其余按词频 | `wrongBook.wrongCount` / `nextDue` |

### 4.3 规格

#### R3-A 数据模型改造（P0）

```ts
// src/domain/settings/types.ts
export type StudyOrder = 'random' | 'freq' | 'weak' | 'wrong';
// UserSettings 增加：
studyOrder: StudyOrder;        // 新增，默认 'random'
randomNoRepeatWindow: number;  // 新增，默认 10（会话内去相邻重复窗口）
// freqOrdering 保留（向后兼容），由迁移函数映射：
//   freqOrdering=true  → studyOrder='freq'
//   freqOrdering=false → studyOrder='random'
```

- `SETTINGS_SCHEMA_VERSION` 从 1 → 2，写迁移（老用户无感，`mergeSettings` 兜底）。

#### R3-B 入口（P0 + P1）

| 入口 | 优先级 | 规格 |
|---|---|---|
| 设置页「学习行为」 | **P0** | 把现有 `freqOrdering` 布尔开关（`SettingsPage.tsx:212-217`）换成 `Segmented` 四选一：「随机 / 词频 / 未掌握优先 / 错词优先」，每项下配一行说明文案（复用现有 `Switch` 的 description 排版） |
| 背词页顶部快捷切换 | **P1** | `StudyRunner` 顶部条右侧加一个 44px 的「🔀」图标按钮 → 底部弹出 Sheet 四选一，**切换后立即重排当前队列剩余部分**（不用退出重开一组），并写入设置（持久化） |
| 桌面端键盘 | P2 | `O` 键循环切换顺序 |

#### R3-C 随机算法（P0）

1. **基础洗牌**：复用 `selector.ts:74-83` 的 `shuffle()`（Fisher–Yates，`random` 可注入 → 可单测，不引入新依赖）。
2. **避免连续重复**（用户没明说但体感关键）：
   - 会话内维护最近 `randomNoRepeatWindow`（默认 10）个已出现 `wordId` 的环形缓冲；
   - 洗牌后做一次「相邻去重」扫描：若 `queue[i]` 落在窗口内，把它与后方第一个不在窗口内的元素交换（只做局部交换，**不破坏整体随机分布**）；
   - 跨会话：把最近 30 个 `wordId` 存进 `meta`（key = `recentWordIds`），新会话开局先排除这批（候选池 < 60 时不生效，防止没词可学）。
3. **作用域**：随机**只作用于新词引入顺序**；到期复习卡保持 `listDue` 的 `due` 升序（FSRS 语义，随机化会破坏间隔重复效果 —— 这条写进代码注释防后人不小心改坏）。
   - 可选：设置里提供「复习卡也随机打散」（默认 **关**）。

#### R3-D 候选池完整性（P0，易被忽略的坑）

- 现状首屏只灌 `chunk 1`（F3.6），选词读全表 → 分片没预取完时"随机"其实只在 550 词里随。
- **规格**：`startSession('learn')` 在选词前先确保候选覆盖 —— 至少保证 `chunk 1–4`（覆盖 `core2104` 全部）已加载；若未加载则 `await loadChunkIntoDb(...)`（可并发，带 loading 态，1–2s）。`prefetchEnabled` 开启时应已在后台完成，此步通常秒过。

#### R3-E 默认值的建议与理由

- **建议默认改为「随机」**（`studyOrder: 'random'`）—— 这是用户明确要的。
- 但要给用户一个"逃生口"：设置页文案如实说明「词频顺序适合第一轮系统过词，随机适合打乱巩固」。

### 4.4 不做的事

- 不做「自定义词单 / 按话题背词」（超出本次范围，可在需求 5 的翻译话题里顺带考虑）。
- 不改变 FSRS 调度本身，只改变**队列呈现顺序**。

---

## 五、需求 4：测试卷数量增加

### 5.1 现状快照（一句话）

**1 套卷 / 12 题 / 3 种题型（写作 1 + 阅读选择 10 + 翻译 1），听力结构化停用，卷子是静态 JSON 由 `scripts/build-papers.ts` 从 `scripts/data/authored/papers/` 构建产出。**

### 5.2 扩容方案（三条腿，可组合）

#### S1：把单卷补齐到非听力规格（P0，性价比最高）

| 项 | 内容 |
|---|---|
| 目标 | 单卷从 12 题 → **32 题**（写作 1 + 阅读 30 + 翻译 1），听力 25 题继续停用 |
| 增量 | 阅读补 20 题：**选词填空 `banked-cloze` ×10** + **长篇匹配 `matching` ×10** —— 这两个 `QuestionKind` 已定义但当前 0 题（F4.4），**顺带完成题型扩充** |
| 体感 | 用户"卷子数量"的抱怨有一半其实是"卷子太薄"，这一条解决得最实在 |
| 工作量 | 数据写作约 0.5 人日/套（含篇章 + 词池 + 解析）；代码改动 ≈ 0（`build-papers` 与 `verify-papers` 已支持，只需补 `materialRef` / `passage.wordBank`） |

#### S2：新增套卷（P1，数量主战场）

| 批次 | 套数 | 说明 |
|---|---|---|
| 首批 | **+3 套 → 共 4 套**（推荐） | 覆盖 2025.06 / 2025.12 / 2026.06 三个考次，每套 32 题 |
| 二批 | **+4 套 → 共 8 套** | 补齐 2024.06 / 2024.12 / 2025.06(第2套) / 2025.12(第2套) |

- **生成方式**：继续走 `authored JSON + scripts/build-papers.ts` 现有管线（F4.6），**零脚本改造**。
- 可选增强：新增 `scripts/build-derived-paper.ts` 模板生成器 —— 输入「题材 + 考点词区间」自动拼装骨架（篇章长度、题号区间、`sectionMeta`），人工只填内容。适合做 8 套以上时降本。
- **每套必须有差异化**：题材（远程办公 / 传统文化 / 环境保护 / 科技教育 / 消费经济…）、考点词区间（从 `words` 按 `freqRank` 区间抽取，见 `DerivedSpec.targetWordPolicy`）、翻译话题。

#### S3：用户导入通道（P2）

- `UserSettings.paperSourcePreference` 字段已存在但**没有任何 UI**（F4.7 附近）。
- 提供「导入自备套卷 JSON」：文件 → 校验（复用 `verifyPapers`）→ **只落本机 IndexedDB**（`provenance: 'user-imported'`），永不上传分发。

#### S4（顺带）：测验题量（P2，一行改动）

- `QuizPage.tsx:213-227` 题数选项 `10 / 20 / 30` → 增加 `50`（若用户说的"测试卷"其实是这个）。

### 5.3 目标数量建议

| 口径 | 保守 | **推荐** | 激进 |
|---|---|---|---|
| 套卷数 | 4 套 | **6 套** | 8 套 |
| 单卷题数 | 32 题 | **32 题** | 32 题 + 恢复听力 25 题 |
| 总题量 | 128 题 | **192 题** | 256 题 |
| 翻译题（可喂给需求 5） | 4 段 | **6 段** | 8 段 |

**推荐 6 套的理由**：① 3 个考次 × 2 套的规模足以支撑"刷卷"体感；② 写作成本可控（见风险）；③ 与需求 5 方案 B 联动 —— 6 段真题段落翻译正好构成一个可用的段落训练题库。

### 5.4 风险评估

| 风险 | 等级 | 说明与对策 |
|---|---|---|
| **内容写作成本**（最大风险，非技术） | 高 | 6 套 × 32 题 = 192 题 + 12–18 篇阅读篇章 + 6 段翻译 ≈ **3–5 人日**纯写作 + 校验。对策：先做 S1（补齐单卷）验证管线，再批量生产；或引入 `build-derived-paper.ts` 模板化降本 |
| **卷子体积** | 低 | 单卷补齐到 32 题 ≈ **35–45 KB**（含 3 篇阅读 + 15 词选词池）；8 套 ≈ 300–360 KB。**首屏零影响** —— `index.json` 仍 < 2 KB，且按套懒加载 + PWA 缓存，用户只下载他点开的那几套 |
| **题库重复率 / 内容质量** | 中 | 8 套时题材与考点极易撞车。对策：建「题材 × 考点词」**去重矩阵**（同题材 ≤ 2 套、同一考点词跨套出现 ≤ 3 次），并在 `verify-papers.ts` 新增 `WARN` 级规则 `DUP_TOPIC` / `DUP_KEYWORD` |
| **合规** | 中 | 全部 `provenance: 'derived'`（内容自撰），**禁止复制真题原文**；必须过 `FORBIDDEN_WORD` 禁用词门禁；`confidence.level` 保持 `medium` 并在 UI 展示来源标识（A7）。新增的 `reading` 篇章尤需注意"改写而非改写后再抄" |
| **置信度误导** | 中 | 卷越多，用户越可能把它当真题。对策：列表页与练习页**继续强制展示**「同源模拟卷 · 置信度 medium · 答案未经官方核对」；不要把年份-month 做得像真考题（现在写 2026 年 6 月容易被误读，建议加"模拟"前缀） |
| **数据版本 / 用户进度** | 低 | 套卷属**镜像区**（`papers/sections/questions`），重灌不影响 `cards` / `wrongBook`。但 `index.json` 变化需走 `paperLoader` 的既有比对逻辑，不要引入新版本号 |
| **断点续考** | 低 | `ExamSession.resume` 已按 `paperId + status='ongoing'` 恢复（F4.6 附近），多套卷并存时逻辑不变，但需补**单测**：同一用户多套卷各有一个 ongoing attempt 时不能互相串 |

---

## 六、需求 5：四级英语翻译训练（重点 · 含竞品调研）

### 6.1 四级翻译题型的事实约束（设计前提）

- 真实题型：**汉译英段落**，约 140–160 个汉字，30 分钟，占 106.5 分（15%）。
- 评分是**人工档位制**（14–15 / 11–13 / 8–10 / 5–7 / 1–4），看「忠实原文 + 句式通顺 + 关键词/得分点命中」。
- 常考话题：中国传统文化（剪纸/灯笼/团圆饭）、经济发展、科技教育、环境保护、社会生活。
- **关键洞察**：四级翻译评分的核心是**得分点（关键词/词组/句型）命中**，而非整句语义相似度 —— 这直接决定了"不接 LLM 也能做自动评分"的可行性（见 §6.3 学术佐证）。

### 6.2 竞品调研（8 个，含 GitHub 项目与同类产品）

| # | 项目 / 产品 | 链接 | 核心做法 | 优点 | 缺点 / 对本项目的启示 |
|---|---|---|---|---|---|
| C1 | **translation-practice**（中英翻译练习） | https://github.com/xazaj/translation-practice | 纯原生 JS，无后端；题库格式 `英文句子\|中文句子` 的 TXT 上传；输入英文 → 点击中文句/回车看参考答案；localStorage 存进度；移动端触控优化 | **最贴近本项目定位**：纯前端 + 离线 + 移动端；题库格式极简，可照搬；"先自己翻、再看答案"的节奏设计好 | 无任何评分（只能肉眼看答案）；无错题本/历史；题库靠用户自己上传 → 我们要**内置题库** |
| C2 | **cet6-all-in-one**（六级全能复习平台） | https://github.com/Drhm1224/cet6-all-in-one | 纯静态，双击 `index.html` 即用；收录 18 套真题；**翻译模块 = 真题原文 + 参考译文对照 + 5 组高频主题词汇** | 证明了"真题段落 + 参考译文 + 主题词汇"这个**最简翻译训练形态**是有效且够用的；纯静态零依赖 | 无输入作答、无评分、无记录，只能"看"；18 套真题文本有著作权风险 → **本项目必须用 derived 自撰** |
| C3 | **CET6-Full-Process-Learning** | https://github.com/HCLEMINI/CET6-Full-Process-Learning | Flask 后端 + DeepSeek；翻译题型做「出题 → 做题 → 评分 → 倒计时」闭环；另有**精读训练：关键词生成原文 → 逐段翻译 → AI 逐段纠错** | 功能形态最完整，**"逐段翻译 + AI 逐段纠错"正是我们要的交互范式**；API Key 只在服务端 | 需要 Python 后端，**与本项目纯前端 PWA 冲突**；不可离线；AI 是强依赖（断了就没法用） |
| C4 | **AutoGradAI**（AI 英语作文自动批改） | https://github.com/rice-awa/AutoGradAI | LLM 批改；15 分制 + 详细理由；错误精确定位与分类（拼写/语法/用词）；亮点分析；改进建议；流式响应；支持 DeepSeek/OpenAI/Ollama 兼容端点 | **评分口径（15 分制）可直接对齐四级翻译**；错误分类 + 亮点的反馈结构值得抄；流式响应对手感很重要 | Python + LangChain 后端；重度依赖 LLM 且需 Key；**无离线兜底** |
| C5 | **writeo**（AI 作文评分平台） | https://github.com/rgilks/writeo | Next.js + Cloudflare Workers + Modal；RoBERTa 多维度评分 + GECToR/Seq2Seq 语法纠错 + LanguageTool + LLM 反馈；CEFR 分级；**是 PWA，默认数据不出浏览器** | 架构上最"专业"；"隐私优先 / 数据默认不出浏览器"的理念与我们一致；**是 PWA** 这点证明重功能也能 PWA 化 | 需要 GPU 服务 + 多层 serverless，**工程量是本项目数量级的 10 倍以上**，不可照搬；只能借鉴评分维度设计 |
| C6 | **EssayMate** | https://github.com/July-Tea/EssayMate | 前后端分离；接入 Doubao / Tongyi / Kimi；雅思托福 GRE 作文批改 + 自动评分 + 详细反馈 | 证明**国内模型（豆包/通义/Kimi）做批改**可行且成本低，对接友好 | 需后端；不含翻译专项；无离线 |
| C7 | **cet6-zen**（六级离线做题） | https://github.com/mx-pai/cet6-zen | 离线优先；PDF.js 渲染真题；作文/翻译手写区；LocalStorage + IndexedDB；自动保存 | **离线做题 + 手写区 + 自动保存**的交互可借鉴；证明"翻译训练"在离线 PWA 里完全可做 | 依赖 PDF 真题（合规风险）；翻译只是"有地方写"，**无任何反馈** |
| C8 | **nyc-cet-vocab**（四六级词汇闯关） | https://github.com/nyc1013/nyc-cet-vocab | React 18 + Vite + Tailwind；闪卡 3D 翻转 + 四选一 + 快速刷词 + 错题本；键盘快捷键；移动端友好 | 技术栈与我们**几乎一致**；其"移动端触屏友好 + 桌面端键盘快捷键双轨"的做法已被本项目采纳 | 只做词汇，无翻译；可作为 UI/交互细节的对标参照 |

### 6.3 学术佐证：不接 LLM 也能自动评分

关键词命中评分是**中英翻译自动评分领域的标准做法**，多篇论文都以此为第一特征：

- 《An automatic scoring method for Chinese-English spoken translation based on attention LSTM》：三大评分参数 = **语义关键词命中（含同义词判别）** + 句子漂移 + 流畅度；关键词评分明确要求处理「关键词数量」与「同义词」两件事。
- 《Neural-based automatic scoring model for Chinese-English interpretation》（BERT-BiLSTM-Attention）：关键词分 + 内容分 + 语法分 + 流畅分加权求和；关键词评分专门构建「关键词 + 高频同义词」语料库。
- 《Towards On-line Automated Semantic Scoring of English-Chinese Translation》：关键词匹配 + 语义相似度混合；按词性区别对待（动词/形容词/副词用语义特征，名词代词习语用关键词匹配）。

> **对本项目的结论**：做一个「**得分点关键词 + 同义词表命中**」的离线评分器，在技术上是**站得住脚**的，不是拍脑袋。四级翻译人工评分本来就是档位制 + 得分点制，关键词命中的吻合度天然较高。

### 6.4 现实约束：能不能接 LLM

| 约束 | 事实 |
|---|---|
| 无后端 | 本项目是纯前端 PWA + GitHub Pages，**没有任何服务端** |
| 浏览器直连 LLM 的 CORS | 主流厂商（OpenAI / DeepSeek 等）默认不允许浏览器直连；OpenAI 官方 SDK 的 `dangerouslyAllowBrowser` 明确标注「仅用于原型，**不要在生产使用**」 |
| Key 泄露 | 前端代码对用户完全透明，任何写在前端的 Key 都能被 DevTools 提取；业界共识是「**没有前端 Key 这回事**」，必须 BFF/后端代理 |
| 结论 | **只能做「用户自带 Key（BYO Key）」模式**：Key 只存用户本机 IndexedDB，由用户自己承担风险，UI 必须显著提示。同时**必须保证断网/无 Key 时核心功能 100% 可用** |

### 6.5 四个可落地方案

---

#### 方案 A ——「离线单句翻译训练」（不依赖 LLM，MVP 首选）

**一句话**：内置 200–300 句汉译英单句题库，输入英文 → 关键词命中评分 → 看参考译文 → 错题进错句本。

| 维度 | 内容 |
|---|---|
| **功能清单** | ① 单句汉译英题库（200–300 句，覆盖 15 个四级常考话题：传统文化 / 经济 / 科技 / 教育 / 环境 / 健康 / 旅游 / 交通 / 饮食 / 节日 / 城市化 / 互联网 / 就业 / 老龄化 / 体育）<br>② 手机键盘友好的作答输入（自动聚焦、自动首句大写、不自动纠错首字母）<br>③ **关键词命中评分**：每句标注 3–6 个 `keyPoints`（含 `synonyms[]`），提交后给「命中 x/y」+ 逐条 ✓/✗<br>④ **我的译文高亮**：命中得分点绿色、缺失得分点红色下划线<br>⑤ **参考译文**（默认折叠，先自评再展开，防直接抄）<br>⑥ **提示分级**：`提示1` 得分点中文 → `提示2` 首字母/词性 → `提示3` 句型结构<br>⑦ **错句本**：存我的译文 + 参考译文 + 命中详情 + 话题，支持重做<br>⑧ 话题筛选 + 进度（已练 N / 总数） |
| **交互流程（手机）** | 首页入口「翻译训练」→ 选话题（或「混合 10 句」）→ 看中文句 →（可选）点「提示」→ 输入英文 → 按「提交」→ 评分卡（命中 4/5 + 逐条清单 + 我的译文高亮）→ 按「看参考译文」→ 按「收进错句本」→ 按「下一句」→ 10 句后出小结卡 |
| **数据来源** | **静态题库**：新增 `public/data/translation/sentences.json`（自撰 + 参考译文 + keyPoints + synonyms + 话题 + 难度），由 `scripts/build-translation.ts` 从 `scripts/data/authored/translation/` 构建 + `verify-translation.ts` 门禁（得分点非空 / 参考译文非空 / 禁用词 / 话题合法）。**合规：全部自撰，不复制真题原文** |
| **实现难度 / 工作量** | **中低**。开发 ≈ 1.5–2 人日（新页面 + 评分纯函数 + 入库 + 错句本）；题库写作 ≈ 2–3 人日（300 句 + 得分点标注，这是主要成本） |
| **离线可用性** | **100% 离线**（题库随 PWA 缓存，评分纯前端） |
| **与现有 PWA 契合度** | **高**。复用 Dexie（新增 `translationBook` 表，归入用户进度区）、复用 `Badge/Card/Button/Progress`、评分逻辑放 `src/domain/translation/scorer.ts`（纯函数，可 100% 单测，符合铁律 A1） |
| **主要取舍** | 单句 ≠ 真题段落（真实考试是段落）；关键词命中是近似评分，会漏判同义改写、误判词形 |

---

#### 方案 B ——「真题段落翻译 + 逐句拆解 + 自我批改」（复用现有管线，最省）

**一句话**：把卷子里的翻译段落拆成逐句来做，交卷后整段参考译文 + 逐句对照 + rubric 自评 + 生词一键收藏。

| 维度 | 内容 |
|---|---|
| **功能清单** | ① 复用现有 `ExamQuestion.kind='translation'` 段落题（当前 1 段，随需求 4 扩容到 6 段）<br>② **段落自动拆句**（按 。；！？ 切分为 4–6 个分句），一句一屏，手机上不必滚长文<br>③ 逐句输入英文，随时可回看上一句<br>④ 交卷后：**整段参考译文** + **逐句对照（我的 / 参考）** + `rubric` 评分参考 + **自评档位**（14-15 / 11-13 / 8-10 / 5-7，与四级真实档位对齐）<br>⑤ **生词一键加入生词本**（复用已有的 `ExamQuestion.keyWordHints` 字段！）<br>⑥ 历史记录（哪年哪套、用时、自评档位） |
| **交互流程（手机）** | 真题套卷 → 翻译板块 → 显示中文段落全文 + 「开始逐句翻译」→ 第 1/N 句（中文分句）→ 输入 → 「下一句」→ …→ 「完成」→ 对照页（左右/上下对照我的 vs 参考）→ 选自评档位 → 「加入生词本」→ 完成 |
| **数据来源** | **现有 papers + 需求 4 扩容后的段落**（derived 自撰）。另需为每段补 `referenceTranslation`（参考译文）与 `keyPoints` —— 需扩展 `ExamQuestion` 类型（新增可选字段，不破坏现有结构） |
| **实现难度 / 工作量** | **低**。开发 ≈ 1 人日（高度复用 `ExamRunner` / `ExamSession` / `sectionPlan` 的 K1–K3 契约，`translation` 板块本就存在于 `sectionMeta`）；题库成本已计入需求 4 |
| **离线可用性** | **100% 离线** |
| **与现有 PWA 契合度** | **极高**。零架构改动，不新增表（作答存在 `answerSheets` / `attempts`），完全符合 K1–K3 硬约束 |
| **主要取舍** | **无自动判分**（仍是自评），反馈强度弱；题量依赖需求 4（现在只有 1 段，不够练） |

---

#### 方案 C ——「A + 可选 LLM 智能批改（用户自带 Key）」

**一句话**：在方案 A 之上加一个「AI 批改」按钮，用户填自己的 API Key 就能拿到逐句纠错和 15 分制评分；没 Key / 断网时自动回退到关键词评分。

| 维度 | 内容 |
|---|---|
| **功能清单** | 方案 A 全部 +<br>① 设置页新增「AI 批改」卡片：开关 + Base URL + 模型名 + API Key（**仅存本机 IndexedDB，导出备份时排除密钥**）<br>② 提交后多一个「✨ AI 批改」按钮 → 返回：**0–15 分档位** + 逐句纠错（原句 → 建议句 + 错误类型：语法/搭配/时态/中式英语/漏译）+ 亮点 + 改进建议，**流式输出**<br>③ **双评分并列展示**：关键词命中（离线、即时）+ AI 评分（联网、慢），让用户交叉验证<br>④ 无 Key / 断网 / 超时 → **静默回退**，只显示关键词评分，并提示「AI 批改不可用，已用离线评分」 |
| **交互流程（手机）** | 同方案 A，评分卡上多一枚「✨ AI 批改」按钮 → 点击后按钮转圈（流式打字机输出）→ 展开 AI 反馈折叠区 |
| **数据来源** | 题库同 A（静态）；评分来自用户自建的 OpenAI 兼容端点（DeepSeek / 通义 / Kimi / 硅基流动 / 本地 Ollama） |
| **实现难度 / 工作量** | **中**。开发 ≈ 2–3 人日（配置页 + 兼容端点适配 + 流式渲染 + 提示词工程 + 错误/超时/回退）+ 提示词调试 ≈ 0.5 人日 |
| **离线可用性** | **核心 100% 离线**，仅 AI 增强需联网 |
| **与现有 PWA 契合度** | **中**。引入网络依赖与 `UserSettings.aiEnabled`（目前恒 false）的语义变更；与「纯离线 PWA」定位有张力，必须做成**可选增强而非强依赖** |
| **必须写进 UI 的提示** | 「Key 保存在你自己的手机浏览器里，我们没有任何服务器，也无法替你保管。请不要使用高额度的主 Key，建议单独申请一个限额 Key。」 |
| **主要取舍** | Key 泄露风险由用户自担；CORS 可能导致部分端点直连失败（需实测清单）；成本由用户承担 |

---

#### 方案 D ——「翻译训练营（全功能）」

**一句话**：A + B + C 全部，再加每日一练、计时、话题分类、高频句型库、错句间隔重复、历史趋势。

| 维度 | 内容 |
|---|---|
| **功能清单** | A + B + C 全部 +<br>① **每日一练**：首页卡片「今日翻译」，每天推 1 段 + 3 句，计入连续打卡（`streak` 已有）<br>② **计时**：单句 60s / 段落 30min（可关），结束提醒但不强制交卷<br>③ **话题分类体系**：15 个四级常考话题，每个话题有词汇/句型预习卡<br>④ **高频句型库**：100 个四级翻译高频句型（如 `It is + adj. + that…`、`With the development of…`、`play an important role in…`），可收藏、可在作答时插入<br>⑤ **错句间隔重复**：错句本接入 FSRS（复用 `scheduler`），到期自动出现在今日练习<br>⑥ **历史与趋势**：命中率曲线（复用 `src/ui/charts/LineChart`）、分话题雷达、连续天数<br>⑦ **一键加入生词本**：作答中长按单词即可收藏 |
| **数据来源** | 静态：300 句 + 100 句型 + 6–8 段真题段落 + 15 话题词表。约 **150–250 KB** |
| **实现难度 / 工作量** | **高**。开发 ≈ 5–8 人日；题库 + 句型库写作 ≈ 4–6 人日 |
| **离线可用性** | 核心 100%，AI 增强需联网 |
| **与现有 PWA 契合度** | 高，但工期长；建议**分两期**：一期 = A + B（离线全闭环），二期 = C + 每日一练 + 错句 FSRS + 趋势 |
| **主要取舍** | 工期最长；功能多也意味着维护面大，与「小而美」的现有定位需要权衡 |

### 6.6 各方案对比总表

| | 方案 A 离线单句 | 方案 B 段落自评 | 方案 C A+LLM | 方案 D 全功能 |
|---|---|---|---|---|
| 自动评分 | ✅ 关键词命中 | ❌ 自评档位 | ✅ 关键词 + AI | ✅ 关键词 + AI |
| 需要联网 | ❌ 不需要 | ❌ 不需要 | ⚠️ 仅 AI 批改 | ⚠️ 仅 AI 批改 |
| 题量 | 200–300 句（新写） | 1 段 → 6 段（随需求 4） | 同 A | 同 A + B |
| 开发工作量 | 1.5–2 人日 | ~1 人日 | +2–3 人日 | 5–8 人日 |
| 题库写作 | 2–3 人日 | 计入需求 4 | 同 A | 4–6 人日 |
| 架构改动 | 中（新页面 + 新表 + 新域） | **极小**（复用现有） | 中（+ 网络层 + 设置） | 大 |
| 离线可用 | 100% | 100% | 核心 100% | 核心 100% |
| 契合度 | 高 | **极高** | 中 | 高但工期长 |
| 我的建议 | **做**（核心） | **做**（顺带，成本极低） | 视用户意愿 | 拆成两期 |

**产品推荐路径**：**一期 = B + A**（先把"能练、有反馈、有错句本"跑通，全程离线），**二期视用户反馈再上 C 的 AI 批改**。

### 6.7 技术落点建议（供架构师参考，非最终设计）

```
src/domain/translation/
  types.ts        // TranslationItem / KeyPoint / Attempt / Score
  scorer.ts       // ★ 纯函数：关键词+同义词命中评分（可 100% 单测，铁律 A1）
  segment.ts      // 段落拆句（纯函数）
src/data/db/db.ts  // 新增表：translations（镜像区）/ translationBook（用户进度区）
src/features/translation/
  TranslationHomePage.tsx    // /translation  话题选择 + 每日一练
  SentenceRunner.tsx         // 单句作答 → 评分 → 参考译文
  PassageRunner.tsx          // 段落逐句（方案 B）
  WrongSentenceBook.tsx      // 错句本
scripts/
  build-translation.ts       // 构建题库
  verify-translation.ts      // 门禁（得分点非空/参考译文非空/禁用词/话题合法）
public/data/translation/
  sentences.json  /  index.json
router.tsx        // 新增 /translation、/translation/passage/:id
BottomTabBar      // 是否给翻译一个一级 Tab？建议：先放首页卡片（与真题同级），
                  // 等日均使用稳定后再考虑替换「复习」位 —— 列为拍板项 Q11
```

---

## 七、需要用户拍板的选项

> 用户明确说「功能上选择可以交给我」。以下每项都是**一句话 + 关键取舍**，可直接做选择题。

### 7.1 需求 5（翻译训练）—— 主选项，请选一个

| 选项 | 一句话描述 | 关键取舍 |
|---|---|---|
| **① 先做轻量版（A + B）** ⭐ 推荐 | 内置 200–300 句汉译英单句（自动关键词评分 + 参考译文 + 错句本）+ 把卷子的翻译段落拆成逐句练（自评对照） | **全程离线、不用任何 AI、不花钱**；一周左右能上线；缺点是 AI 那种"逐句告诉你哪里错了"没有 |
| **② 轻量版 + AI 批改（A + B + C）** | 在上面加一个「AI 批改」按钮，你自己填 API Key（DeepSeek / 通义 / Kimi 等都行），能拿到 15 分制评分 + 逐句纠错 + 改进建议 | 批改质量明显更好；但**要自己申请 Key、自己承担费用与泄露风险**，且**必须联网**；没网/没 Key 时自动退回离线评分，不影响使用 |
| **③ 全功能训练营（D）** | 单句 + 段落 + AI 批改 + 每日一练 + 计时 + 100 个高频句型库 + 错句按遗忘曲线复习 + 命中率趋势图 | 功能最全、最像备考 App；但**工期长（约 2 周+）**，一次上线太多内容，出问题不好定位 |
| **④ 只做段落版（B）** | 只把真题/模拟卷里的翻译段落拆成逐句做，交卷后对照参考译文自己打分 | **最省事、最贴近真实考试**；但**没有自动评分**，且题量取决于卷子数量（现在只有 1 段） |

### 7.2 需求 5 —— 配套小选项

| # | 问题 | 选项 |
|---|---|---|
| Q11 | 翻译训练要不要占底部导航栏的一级 Tab？ | A. 先放首页卡片（与"真题套卷"同级，不挤掉现有 6 个 Tab）⭐ / B. 直接占一个一级 Tab（需从现有 6 个里换掉一个，建议换"复习"） |
| Q12 | 参考译文什么时候给？ | A. **先自评再展开**（防直接抄）⭐ / B. 提交后直接并排展示（省一步） |
| Q13 | 要不要计时？ | A. 不计时（建议，手机端压力小）⭐ / B. 单句 60s / 段落 30min，可关闭 |
| Q14 | 错句本要不要按遗忘曲线（FSRS）自动安排复习？ | A. 要（复用现有复习引擎） / B. 不要，只是一个列表手动重做（先简单）⭐ |
| Q15 | 如果做 AI 批改，你倾向哪种模型？ | A. DeepSeek（便宜） / B. 通义千问 / C. Kimi / D. 先做通用「OpenAI 兼容端点」我自己填 ⭐ |

### 7.3 需求 1~4 需要确认的点

| # | 需求 | 问题 | 选项 |
|---|---|---|---|
| Q1 | 1 | 音标补多少？ | A. **只补核心 2104 词**（覆盖率目标 ≥95%，体积最小、最快）⭐ / B. 全量 5278 词（≥85%） |
| Q2 | 1 | 卡片还要不要"点整张卡翻卡"？ | A. **去掉，只用按钮翻卡**（防误触）⭐ / B. 保留（习惯性点卡片的人不受影响） |
| Q3 | 1 | 音标要不要英音美音都显示？ | A. 都显示，各配一个喇叭（可按口音播）⭐ / B. 只显示设置里的那一种口音 |
| Q4 | 2 | 收藏按钮放哪？ | A. **卡片右上角 + 翻卡后底部按钮，两处同步**⭐ / B. 只在卡片右上角 / C. 只在底部操作区 |
| Q5 | 2 | 词本页默认打开哪个 Tab？ | A. 记住上次打开的⭐ / B. 默认生词本 / C. 维持现状（错词本） |
| Q6 | 3 | **默认出词顺序改成什么？** | A. **随机**（按你说的）⭐ / B. 未掌握优先 / C. 保持词频，你每次手动切 |
| Q7 | 3 | 随机要不要跨天去重（避免连续几天背到同一批）？ | A. 要，记最近 30 个词⭐ / B. 不要，每天完全重新随机 |
| Q8 | 3 | 复习卡（到期的旧词）要不要也随机打散？ | A. **不要**，复习卡按到期时间排（这是间隔重复的规矩）⭐ / B. 也要随机 |
| Q9 | 4 | **套卷目标数量？** | A. 4 套（保守） / B. **6 套**（推荐，约 192 题）⭐ / C. 8 套（激进，约 256 题，写作成本高） |
| Q10 | 4 | 你说的"测试卷"是指？ | A. **真题套卷**（列表页那个"1 套"）⭐ / B. 四选一测验的题数（现在最多 30 题，要不要加 50） / C. 两个都要 |

---

## 八、验收标准（Definition of Done）

### 需求 1

- [ ] 未翻卡时，卡片下方有一枚 **≥44px 高、满宽** 的「翻卡看释义」按钮；点击后释义显示。
- [ ] 已翻卡时，底部出现 **≥44px** 的「🔊 重播」按钮；点击后单词发音（每种 ttsProvider 下各验一次：系统合成 / 有道）。
- [ ] `ttsProvider = 'off'` 时重播按钮置灰并给出说明文案。
- [ ] 单词下方**显示音标**：核心 2104 词覆盖率 ≥ 95%（脚本 `verify-phonetics` 输出的报告为准）；未命中的词不显示占位符、不显示空白行。
- [ ] 音标区英/美各自的喇叭触控区 **≥44×44**；点"英"播英音、点"美"播美音（与设置口音解耦）。
- [ ] 卡片整块点击翻卡已移除；点击例句中的单词仍能跳转到 `/word/:id`。
- [ ] 桌面端键盘快捷键**全部保留**：Space/Enter 翻卡、←↓→ 评级、Esc 退出；新增 `R` 重播。
- [ ] 所有新增按钮有 `aria-label`；`npm run typecheck` / `lint` / `test` 全绿；`Phonetic` / `WordCard` 单测补充覆盖新 props。
- [ ] 音标数据源已写入 `public/data/ATTRIBUTION.md` 与 `docs/依赖许可记录.md`。

### 需求 2

- [ ] 背词卡片右上角有 **≥44×44** 的 ★/☆ 按钮，**未翻卡时也在**。
- [ ] 点击 ☆ → 变实心 ★ + Toast「已加入生词本 · 到「词本」查看」（Toast 不遮挡评级按钮）。
- [ ] 点击 ★ → 移出生词本 + Toast 提示（**可取消**，这是修复现状 bug 的关键验收点）。
- [ ] 在 `/word/:id` 收藏后 → 回背词页遇到同一个词，按钮**已是实心状态**（状态同步，非本地 state 串词）。
- [ ] 收藏后到 `/books?tab=vocab` 能看到该词，按加入时间倒序在最前。
- [ ] 查词页 `SearchPage` 的 ★ 按钮**也改为可取消**，且与详情页/背词页共用同一个 hook（三处零漂移）。
- [ ] 收藏**不影响** FSRS 排期：收藏 10 个词后，学习队列的新词数与未收藏时一致（单测断言）。
- [ ] `useVocabToggle` 有单测覆盖：加入 / 移除 / 写库失败回滚。

### 需求 3

- [ ] 设置页「学习行为」出现四选一：随机 / 词频 / 未掌握优先 / 错词优先（不再是布尔开关）。
- [ ] 选「随机」后，连续 3 天各开一组新词，**每天的第一批词不重合 ≥ 80%**（跨天去重生效）。
- [ ] 同一组内**不出现相邻重复的同一个词**（窗口 10）。
- [ ] 选「词频」时，队列 `freqRank` 严格升序（复用 `isStrictlyAscending` 断言，单测）。
- [ ] 选「未掌握优先」时，`lapses ≥ 1` 或 `state ∈ {0,1}` 的词排在前 50%。
- [ ] 选「错词优先」时，`wrongBook` 中 `wrongCount` 最高的词排在前 50%。
- [ ] 老用户升级：原 `freqOrdering=true` 自动映射为「词频」，`false` 映射为「随机」，**不丢任何设置**（迁移单测）。
- [ ] 选词前确保候选池覆盖完整（已加载 chunk ≥ 覆盖 `core2104` 的分片），否则先加载并展示 loading。
- [ ] 复习卡顺序**不受随机影响**（单测断言 due 升序）。

### 需求 4

- [ ] `public/data/papers/index.json` 的 `papers.length` ≥ 目标数量（按 Q9 拍板结果）。
- [ ] 每套卷 `questionCount` ≥ 32（非听力规格：写作 1 + 阅读 30 + 翻译 1）。
- [ ] 题型覆盖：`essay` / `choice` / `banked-cloze` / `matching` / `translation` **五种都有题**（当前缺 2 种）。
- [ ] `pnpm run data:verify-papers` **零 error**；新增卷全部 `provenance='derived'` 且带 `provenanceLabel` + `confidence` + `derivedFrom`。
- [ ] 每套卷的翻译题都带 `referenceTranslation`（供需求 5 方案 B 使用）。
- [ ] 列表页与练习页**持续展示**来源标识与置信度（不得因为卷变多而弱化）。
- [ ] 体积门禁：单套 JSON ≤ 50 KB；`index.json` ≤ 3 KB；首屏不加载任何套卷正文。
- [ ] 断点续考单测：用户同时对 2 套卷各有一个 `ongoing` attempt，各自恢复互不串。
- [ ] 若 Q10 选 B 或 C：`QuizPage` 题数选项包含 50，且 50 题能正常出卷（干扰项不足时给出友好提示而非白屏）。

### 需求 5（按拍板方案裁剪）

- [ ] 路由 `/translation` 可访问，手机端（375×667 视口）**无横向滚动**，所有按钮触控区 ≥ 44px。
- [ ] 提交译文后 **1 秒内**给出评分结果（离线评分，纯前端计算）。
- [ ] 评分结果含：命中得分点数 `x/y` + 逐条 ✓/✗ 清单 + 我的译文高亮。
- [ ] 参考译文可展开/收起；方案 A 默认收起（按 Q12）。
- [ ] 错句本可存、可列表、可重做、可删除。
- [ ] `src/domain/translation/scorer.ts` 单测覆盖率 ≥ 90%，且包含边界用例：大小写、复数/时态词形变化、同义词命中、多余空格、标点。
- [ ] **离线验证**：飞行模式下，做题 → 评分 → 存错句本 → 全程可用（无网络请求，DevTools Network 面板确认为 0）。
- [ ] 题库构建走 `scripts/build-translation.ts` + `verify-translation.ts`，门禁零 error；来源写入 `ATTRIBUTION.md`（自撰标注）。
- [ ] 若选方案 C/D：无 Key / 断网 / 超时时，AI 批改按钮给出明确提示，**核心流程仍可完成**，不出现白屏或无限 loading。
- [ ] 若选方案 C/D：设置页 AI 配置区有**显著的风险提示文案**；导出的备份 JSON **不含明文 API Key**（单测断言）。

---

## 九、附录：本次勘查涉及的文件清单

**读过的源码**
- `src/features/learn/StudyRunner.tsx`、`src/features/learn/LearnPage.tsx`、`src/features/learn/ReviewPage.tsx`
- `src/ui/word/WordCard.tsx`、`Phonetic.tsx`、`RatingBar.tsx`、`SenseList.tsx`、`ExamSentenceList.tsx`
- `src/ui/primitives/Button.tsx`（`SIZE_CLASS`: sm h-8 / md h-10 / lg h-12）
- `src/features/settings/SettingsPage.tsx`
- `src/features/search/SearchPage.tsx`
- `src/features/word-detail/WordDetailPage.tsx`、`src/features/books/WordBooksPage.tsx`
- `src/features/quiz/QuizPage.tsx`、`src/services/quizPool.ts`、`src/domain/quiz/generator.ts`
- `src/features/mock/MockExamPage.tsx`、`ExamRunner.tsx`、`ExamResultPanel.tsx`
- `src/features/papers/PapersPage.tsx`
- `src/domain/exam/types.ts`、`sectionPlan.ts`、`grader.ts`、`result.ts`
- `src/domain/word/types.ts`、`selector.ts`、`tier.ts`
- `src/domain/settings/types.ts`
- `src/services/studySession.ts`、`src/store/useStudyStore.ts`
- `src/data/db/db.ts`、`src/data/repos/vocabRepo.ts`、`wordRepo.ts`
- `src/data/loader/chunkLoader.ts`、`paperLoader.ts`、`src/data/sources/BuiltinPaperSource.ts`
- `src/hooks/useTts.ts`、`src/hooks/useKeyboard.ts`、`src/services/speech/*`
- `src/router.tsx`、`src/app/layout/BottomTabBar.tsx`

**读过的数据 / 脚本**
- `public/data/manifest.json`（5278 词 / 2104 核心 / 10 分片 / sentences.count = 0）
- `public/data/papers/index.json`、`public/data/papers/derived-2026-06-set1.json`
- `public/data/words/chunk-001.json`（字段样本；实测全库 `phoneticUk/Us` 覆盖率 = 0）
- `scripts/build-papers.ts`、`scripts/verify-papers.ts`、`scripts/build-wordbank.ts`、`scripts/build-sentences.ts`
- `scripts/data/authored/papers/`（当前仅 1 个源卷）、`scripts/data/raw/papers/`（空）
- `package.json` scripts（`data:papers` / `data:verify-papers` / `data:all`）

**竞品调研来源**
- C1 https://github.com/xazaj/translation-practice
- C2 https://github.com/Drhm1224/cet6-all-in-one
- C3 https://github.com/HCLEMINI/CET6-Full-Process-Learning
- C4 https://github.com/rice-awa/AutoGradAI
- C5 https://github.com/rgilks/writeo
- C6 https://github.com/July-Tea/EssayMate
- C7 https://github.com/mx-pai/cet6-zen
- C8 https://github.com/nyc1013/nyc-cet-vocab
- 学术：《An automatic scoring method for Chinese-English spoken translation based on attention LSTM》；《Neural-based automatic scoring model for Chinese-English interpretation》（BERT-BiLSTM-Attention）；《Towards On-line Automated Semantic Scoring of English-Chinese Translation》
- 工程约束：OpenAI SDK `dangerouslyAllowBrowser` 官方警告；浏览器端 Key 暴露风险与 BFF 代理共识
