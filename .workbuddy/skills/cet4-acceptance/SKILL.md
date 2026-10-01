---
name: cet4-acceptance
description: 大学英语四级学习网站（cet4-master，仓库根 C:\Users\13177\Desktop\yy）的里程碑独立验收流程。当需要验收/复核 M1/M2/M3 等里程碑、跑六命令门槛、或在本机（Windows）执行 git/node/pnpm/PowerShell 校验时使用。
agent_created: true
---

# cet4-master 里程碑独立验收

适用于「英语四级学习网站」项目的每个里程碑收尾（M1 背词闭环 / M2 模考·测验·导入导出 / M3 听力专项·PWA）。
目标：**证明代码真的工作**，而不是确认它存在。

## 1. 六命令门槛（缺一不可，全绿才算过）

```bash
pnpm typecheck        # tsc --noEmit ×2（app + node）
pnpm lint             # eslint .
pnpm test             # vitest run
pnpm test:coverage    # 域层阈值 85%（include 仅 src/domain/**）
pnpm build            # tsc + vite build
pnpm data:verify      # 数据体检（error 0 / warn 0 才 PASS）
```

记录**实测值**，不要只记「EXIT 0」：测试文件数/用例数、coverage 四个百分比、`gzip` 体积（与上一里程碑对比**是否回归**）、`data:verify` 的 PASS/SKIP 数。

## 2. 验收方法论（本项目的血泪规则）

1. **不采信子代理自检**。历史教训：工程师报「lint 全绿」实际 8 problems；报「工作区干净」实际留 13 个探针文件 → **必须自己 `git status --porcelain`**。
2. **拿实测值，不要采信断言字符串**。写独立脚本直接调用领域层并打印真实数值 —— 「评分倒挂」（新卡 Again 10min > Hard 6min）就是这么抓到的。
3. **必须构造反例 / 破坏性测试**：篡改数据看体检是否真拦；构造边界值（`due=now` / `now+1` / `now+W` / `now+W+1`）；构造「多个子块共用同一 DB」等易错场景。
4. **断言不变量，而非绝对值**。领域层单测必须断言**顺序/单调性/边界关系**（如 `Again ≤ Hard < Good`）。只逐条断言绝对值会「数学全对、语义全错」。
5. **警惕隐性顺序假设**：若代码依赖「上游恰好有序」，要么显式排序，要么在注释写明该依赖。
6. **游标数组的 off-by-one**：`cursor` 指向**当前项**时，历史段是 `[0, cursor]`（**含当前**），待答区是 `i > cursor`。任何 `filter`/`splice` 前先确认游标语义。
7. **验证方也要自我反证**：QA 自建用例同样会有 bug（期望值硬编码错误、共用 DB 致状态污染）。发现后**如实标注**。

## 3. 本机环境坑（Windows，务必先读）

- **Git Bash shim 已坏**：`dirname` / `ls` / `grep` / `sed` / `tail` 全 `command not found`。**`git` 可用，其余用 PowerShell 或专用工具（Glob/Grep/Read）**。
- **PowerShell 不回显 stdout**：把结果 `Set-Content` 写文件再用 `Read` 读。
- `Invoke-Expression` 被安全策略拦截；`Remove-Item` 走 safe-delete（会报 trash 失败但**实际已删**，用 `Test-Path` 判断）。
- `ConvertFrom-Json` 解析大 JSON 不可靠 → 用 Node 脚本。
- 托管 node：`C:\Users\13177\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`（需手动加 PATH）；pnpm 12.8.1。
- 起本地预览：`node ./node_modules/vite/bin/vite.js preview --port 4173 --strictPort --host 127.0.0.1`（vite 走 node 不受 shim 影响；**不要绑 0.0.0.0**）。
- **并行子代理也在写 `_*` 临时文件** → 收尾清理必须等所有子代理结束后再做。

## 4. 项目铁律（架构约定，验收时逐条核）

- A1 `src/domain/**` 纯函数：零 React / 零 IO / 零网络
- A2 UI 不直接 fetch：只能经 `services → repos`
- A3/A4 数据源可替换（`WordSource` / `PaperSource` 接口）
- A5 不硬编码音频 URL；A6 音频零入库（CI 门禁）
- A7 `provenance=original` 的真题必须带 UI 免责声明 + 存疑标记
- A8 领域层单测断言**不变量**而非魔法数字
- 用户进度区（cards/wrongBook/…）**永不被数据管线触碰**；只读镜像区可整体重建

## 5. 当前基线（M1 定版 `a9f4bab`）

- FSRS：`Again` 保留 ts-fsrs 原生落点再以 `Hard` 的 due **钳制** → 新卡 Again=**60s**、成熟卡 Again=**600s**；不调 ts-fsrs 全局参数
- `waiting` 相位：**队列暂空 ≠ 今日完成** —— 队内 `notBefore` 未到 / 库中 60s 内临期卡 → 显示倒计时，绝不静默完成
- `settle()` 只以**队首** `queue[cursor]` 是否被 `notBefore` 门控判定；进入 waiting 前门控块按 `notBefore` 升序排序
- 待答区（`i > cursor`）同词唯一；队列长度随 Again 线性增长（已接受）
- 已知口径：库中临期卡 `due ∈ (60s, ∞)` 时 `start()` 判 `empty`

## 6. 收尾清单

- [ ] `git status --porcelain` 为空（memory 笔记除外）
- [ ] 根目录 / `tests/` 无 `_*` 临时文件；探针只写 `%TEMP%` 并删净
- [ ] HEAD 明确钉在某个 commit（「冻结于 <hash>」）
- [ ] 门槛六命令实测输出 + 遗留清单（含严重度）
- [ ] 把结论与教训追加到 `.workbuddy/memory/YYYY-MM-DD.md`
