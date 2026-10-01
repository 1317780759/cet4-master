# CET-4 Master

大学英语四级（CET-4）学习网站。**纯前端、零后端、零账号、零云同步**。

- **词频优先**：按约 200 套真卷的实际词频排序（前 2104 词出现 ≥40 次，平均每 5 套卷必现）
- **真题语境**：单词 ↔ 真题双向反查（M1/M2）
- **数据留在本机**：全部学习进度存在浏览器 IndexedDB，不上传任何服务器
- **第二次访问零词库请求**：manifest 版本一致时跳过全部分片下载

## 快速开始

```bash
pnpm install
pnpm data:build        # 构建词库（读 scripts/data/raw，写 public/data）
pnpm data:verify       # 数据体检
pnpm data:attribution  # 生成 ATTRIBUTION.md
pnpm dev               # 本地开发
```

> `public/data/` 已随仓库提交，因此**跳过 `data:build` 也能直接 `pnpm dev`**。
> 只有需要重新抓取上游词库时才跑数据管线。

## 命令一览

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 本地开发服务器 |
| `pnpm build` | 类型检查 + 生产构建（产物 `dist/`） |
| `pnpm preview` | 预览生产构建 |
| `pnpm typecheck` | `tsc --noEmit`（app + node 两份配置） |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest |
| `pnpm data:build` | 词库管线：清洗 → 词频排序 → tier 分档 → 分片 |
| `pnpm data:verify` | 数据体检（CI 门禁，失败退出码 1） |
| `pnpm data:attribution` | 生成 `public/data/ATTRIBUTION.md` |

## 架构

```
scripts/        数据管线（构建期）           → public/data/
public/data/    静态数据分片，运行时 fetch    ★ 不进 JS bundle
src/domain/     纯算法（FSRS / 选词 / 批改）  ★ 零 React、零 IO
src/data/      Dexie / WordSource / loader / repos
src/services/   编排层（M1/M2）
src/store/      Zustand 状态镜像
src/ui/         自研基础组件（Tailwind）
src/features/   页面组装
```

**架构铁律 A1–A9 见 [`CLAUDE.md`](./CLAUDE.md)** —— 编码前必读。

## 数据与合规

- 词库来源：[exam-data/CETVocabulary](https://github.com/exam-data/CETVocabulary)
- 协议：**CC BY-NC-SA 4.0**，**禁止商用**
- 署名与非商用声明见 [`public/data/ATTRIBUTION.md`](./public/data/ATTRIBUTION.md)
- 依赖许可记录见 [`docs/依赖许可记录.md`](./docs/依赖许可记录.md)
- 🔴 **音频零入库**（铁律 A6）：仓库内禁止任何音频文件，CI 强制门禁

## 里程碑

| 期 | 内容 | 状态 |
|---|---|---|
| **M0** | 骨架 + 数据管线 + Dexie schema + CI/CD | ✅ 本轮 |
| M1 | 背词闭环（FSRS + 词频选词 + 统计） | 计划中 |
| M2 | 真题练习（写作/阅读/翻译，听力停用·保留预留位）+ 测验 + 错题/生词闭环 + 导入导出 | 计划中 |
| M3 | PWA / Service Worker / E2E | 计划中 |

## 部署

推送到 `main` 后由 [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
构建并发布到 GitHub Pages（自动注入 `VITE_BASE=/<repo>/`，`public/.nojekyll` 确保 `_next`
之类下划线目录不被 Jekyll 忽略）。
