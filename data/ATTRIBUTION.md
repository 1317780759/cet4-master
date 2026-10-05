# 数据来源与许可声明（ATTRIBUTION）

本目录下的词库数据**并非本站原创**，来自以下开源项目。

## 一、词库数据

| 项 | 内容 |
|---|---|
| 数据源 | [四六级词汇词频排序数据（exam-data/CETVocabulary）](https://github.com/exam-data/CETVocabulary) |
| 数据源标识 | `exam-data/CETVocabulary` |
| 上游版本锚点 | `7f21d0d9ad93c16a17849a24ccc4046e0f64c4af`（抓取于 2026-10-01） |
| **许可协议** | **CC BY-NC-SA 4.0**（[全文](https://creativecommons.org/licenses/by-nc-sa/4.0/)） |
| 商用 | **❌ 禁止** |
| 词条数 | 5278（高频核心 Top 2104：2104） |
| 数据版本 | `2026.10.01.f2477692` |

### 非商用声明（必读）

本站词库衍生自 四六级词汇词频排序数据（exam-data/CETVocabulary），该数据以 **CC BY-NC-SA 4.0** 协议共享。按该协议要求：

- **署名（BY）**：必须保留上述数据源标识与许可信息 —— 已在本文件与站点页脚体现；
- **非商业性使用（NC）**：**不得用于任何商业目的**，包括但不限于付费课程、收费 App、广告变现；
- **相同方式共享（SA）**：若再分发或改编本数据，必须以同一协议（CC BY-NC-SA 4.0）共享。

> 本站点为**个人学习用途的非商业项目**：无账号、无后端、无付费、无广告，
> 所有学习进度仅保存在使用者本机浏览器（IndexedDB），不会上传到任何服务器。

### 统计口径说明

上游数据的排序依据是约 200 套四六级 / 考研 / 专四专八试卷文本中的**实际词频**，前 2104 个单词出现 40 次以上（平均每 5 套卷必现）。
本站仅据此重新编号（`freqRank`）与分档（`tier`），未改动原始释义与词表构成。

## 二、真题材料

本站真题内容分三类，均**不含音频**（架构铁律 A6）：

| 类型 | `provenance` | 说明 |
|---|---|---|
| 第三方整理卷 | `original` | 由第三方公开渠道整理的历年试题文本，**并非官方渠道发布**，未经本站核对，可能存在缺漏或误差 |
| 同源模拟卷 | `derived` | 结构与考点取自公开考纲与真题语料统计，**内容自撰**，不复制任何原文 |
| 用户自备卷 | `user-imported` | 由使用者自行导入，仅落本机 IndexedDB，**永不上传** |

- 试题文本的相关权利归原权利人所有，本站不主张任何权利；
- **本站不提供标准答案，也不保证答案正确性** —— 页面上的答案与解析均标注来源与置信度，仅供参考；
- 用户可自行导入 JSON 套卷，仅落本机 IndexedDB，永不上传；
- 🔴 **音频零入库**（架构铁律 A6）：仓库内不含任何 `.mp3/.m4a/.wav/.ogg/.flac/.aac` 文件，真题原声需由用户自备音频源地址；
- 若权利人提出异议，本站将依 **killSwitch** 流程在 2 分钟内下架相关系列卷（见「四、反馈与下架」）。

## 三、代码依赖许可

| 依赖 | License | 说明 |
|---|---|---|
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | MIT | FSRS 间隔重复调度算法（npm / Snyk / jsDelivr 三方核实一致），本仓库锁定 5.4.2 |
| [react / react-dom](https://github.com/facebook/react) | MIT | UI 运行时 |
| [dexie](https://github.com/dexie/Dexie.js) | Apache-2.0 | IndexedDB 封装 |
| [zustand](https://github.com/pmndrs/zustand) | MIT | 状态镜像 |
| [react-router-dom](https://github.com/remix-run/react-router) | MIT | 路由 |
| [clsx](https://github.com/lukeed/clsx) | MIT | className 拼接 |
| [tailwindcss](https://github.com/tailwindlabs/tailwindcss) | MIT | 样式（v4，CSS-first） |
| [vite / vitest / tsx / typescript / eslint](https://github.com/vitejs/vite) | MIT / Apache-2.0 | 构建与测试工具链 |

## 四、反馈与下架

若你是上述内容的权利人，认为本站使用方式不妥，请通过仓库 Issue 联系我们，我们将在核实后第一时间移除相关内容（代码内已预留 killSwitch 通道）。

<!-- 本文件由 scripts/LICENSE-NOTICE.ts 自动生成，请勿手改。数据版本：2026.10.01.f2477692 -->
