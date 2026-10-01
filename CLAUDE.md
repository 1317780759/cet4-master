# CLAUDE.md —— 编码前必读

> 本文件供 AI 编码助手（Claude / CodeBuddy / 其他）在提交任何代码前阅读。
> 以下 **A1–A7 是架构铁律，Code Review 必查**；违反者一律打回。
> 规则来源：`docs/02-实现方案.md` 第 2.1 节（v1.3 版）。

## 项目一句话

大学英语四级（CET-4）学习网站。**纯前端、零后端、零账号、零云同步**。
数据全部落在本机 IndexedDB；差异化是「真卷词频排序 + 真题语境双向反查」。

## 架构铁律（A1–A7）

| # | 铁律 | 理由 |
|---|---|---|
| **A1** | **`src/domain/` 不得 import React、不得触碰 IndexedDB、不得发网络请求** | 保证 FSRS 调度、词频选词、评分映射可 100% 单测（PRD 常见坑 #5） |
| **A2** | **UI 层不得直接 `fetch()` 数据，只能经 `services/` → `data/repos/`** | 保证「分片加载 + IndexedDB 缓存 + 换源」三件事只在一处实现 |
| **A3** | **词库读取一律经 `WordSource` 接口，禁止硬编码 JSON 结构** | C5 合规要求：换数据源（自建词频库）只需替换适配器，不动业务层 |
| **A4** | **v1.1：套卷读取一律经 `PaperSource` 接口，内置样例与用户导入必须同构** | R11 合规要求：把「真题从哪来」做成可配置，使我们默认不分发任何受保护内容；将来若获授权，只需加文件不改代码 |
| **A5** | **v1.1：音频 URL 只能来自 `audio-index.json` 或 `settings.audioBaseUrl`，代码中禁止硬编码任何真题音频地址** | R11 + C8：保证仓库内零真实音频引用，`defaultMissing: true` 时能干净降级 |
| **A6** | 🔴 **v1.3 铁律：音频零入库。仓库内禁止出现任何 `.mp3` / `.m4a` / `.wav` / `.ogg` / `.flac` / `.aac` 文件；`ExamPaper` 的 `original` 卷不得携带任何 `audioUrl` 字段** | 用户拍板 `original` 后的**减损措施①**（R11）：音频邻接权风险高于文本，且官方从不发行数字音频（FM 广播实证）。CI 强制门禁 |
| **A7** | **v1.3：`provenance='original'` 的卷必须在 UI 三处展示来源与置信度标识，且每题必须可标记「存疑」** | 减损措施②：因无官方底本可对照，必须让用户始终知道「这份材料的可靠性边界」 |

## 补充硬约束（M0 起生效）

1. **纯前端零后端**：除 `public/data/` 静态数据与用户自填的 `settings.audioBaseUrl` 外，
   代码中不得出现任何 `fetch()`。无账号、无云同步、无后端 API、无埋点上报。
2. **数据永不进 JS bundle**：`public/data/` 下的所有数据运行时 fetch，**不得 import**。
3. **只读镜像区 vs 用户进度区严格分离**：
   - 镜像区 `words / sentences / papers / sections / questions` 可整体重建；
   - 进度区 `cards / wrongBook / vocabBook / studyLogs / dailyStats / quizSessions /
     listeningProgress / answerSheets / attempts` **永不被数据管线清空**。
   换数据源、词库升级时只清镜像区 → 用户进度零损伤。
4. **`Word.id` 与 `freqRank` 解耦**：id 用 headword slug（`w_abandon`），
   不用序号 —— 词频重排后用户进度依然对得上。
5. **第二次访问零词库请求**：manifest 版本一致时跳过全部分片下载。

## 目录职责速查

| 目录 | 职责 | 能否依赖 UI |
|---|---|---|
| `scripts/` | 数据清洗与分片，**构建期**执行，产物落 `public/data` | — |
| `public/data/` | 静态数据分片，运行时 `fetch`，**不进 bundle** | — |
| `src/domain/` | 纯算法：FSRS、词频选词、出题、批改、统计 | ❌ 禁止 |
| `src/data/` | 存储与加载：Dexie schema、WordSource、分片 loader、repos | ❌ 禁止 |
| `src/services/` | 编排：会话状态机、队列、TTS、导入导出 | ❌ 禁止（只被 UI 调用） |
| `src/store/` | Zustand 状态镜像 | ✅ |
| `src/ui/` | 无业务的纯展示组件 | ✅ |
| `src/features/` | 页面组装，唯一允许拼装 service + store + ui 的地方 | ✅ |

## 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 本地开发
pnpm typecheck        # tsc --noEmit（app + node 两份配置）
pnpm lint             # eslint
pnpm test             # vitest run
pnpm build            # typecheck + vite build
pnpm data:build       # 词库管线（读 scripts/data/raw，写 public/data）
pnpm data:verify      # 数据体检（CI 门禁）
pnpm data:attribution # 生成 public/data/ATTRIBUTION.md
```

## 合规红线

- 词库来源 `exam-data/CETVocabulary`，协议 **CC BY-NC-SA 4.0，禁止商用**。
  每条 `Word` 必须带 `source` / `license`（`verify-data` 校验）。
- 不得复制任何 GPL-3.0 / 无 License 仓库的代码。
- 仓库内禁止 PDF / MP3 / 大二进制；单文件 < 1 MB。
- 站点页脚必须展示「数据来源 + 非商用声明」。
