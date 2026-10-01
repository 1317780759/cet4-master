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
8. 🔴 **门禁必须在「写完代码之后、提交之前」再跑一次**。顺序错了等于没跑：
   在 `git add` 之前跑绿的门禁，对之后新写的文件**完全无效**。
   实证：自建 dojo（`src/domain/exam/result.ts:5` 注释含 `零 425/710 换算`）正是靠提交前补跑才抓到的。
9. **护栏必须做变异测试，证明它非空转**。把被守护的配置临时改坏（如给 `SCAN_ROOTS` 加 `tests`），
   确认测试**确实变红**且失败信息指向真因；然后**务必改回来**。
   进一步要确认失败信息**不会诱导"改测试去适配"** —— 若默认修法是同步字面量，护栏等于可被一键拆除。
10. **测试失败时先判断是「实现错」还是「断言错」**，默认先怀疑实现。
    实证：`marked` 分支漏计入 `objectiveCorrect`（会偷偷压低正确率）—— 修实现，不改断言。

## 3. 本机环境坑（Windows，务必先读）

- **Git Bash shim 已坏**：`dirname` / `ls` / `grep` / `sed` / `tail` / **`rm`** 全失效
  （`rm` 被 `safe-bin` 劫持，而该脚本自身依赖坏掉的 `dirname`）。**只有 `git` 可用**，其余用专用工具（Glob/Grep/Read）。
- **PowerShell 不回显 stdout** → 一律 `| Out-File -Encoding utf8 <路径>` 后用 `Read` 读。
  ⚠️ **必须显式 `-Encoding utf8`**：默认写 UTF-16，Read 会判为「binary file」而读不到内容。
- ⚠️ **`Remove-Item` 与 `rm` 在本机都可能静默失败**（文件仍在，且 `-ErrorAction SilentlyContinue` 会掩盖）。
  最可靠的删除方式是 Node：`& $node -e "require('fs').unlinkSync('<path>')"`。
  删完**务必用 Glob 复核**，不能假设成功。
- `Invoke-Expression` 被安全策略拦截；`cmd /c` 也被禁。
- `ConvertFrom-Json` 解析大 JSON 不可靠 → 用 Node 脚本。
- **临时文件一律写 `$env:TEMP`**（例：`"$env:TEMP\yy_status.txt"`）。
  **禁止**写工作区：历史上已经污染过两次（`public/data/_regex_probe*.txt` 被 build 复进 `dist/`；`.workbuddy/_*.txt` 进了未跟踪列表）。
- **跑 vitest / tsc / eslint 用 `pnpm exec`**；但要注意 pnpm 的 stderr 会被 PowerShell 误报成 `NativeCommandError`，
  看到这类报错**先看真实退出码**而非报错本身。追求干净输出时可直调：
  `& $node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（同样能绕开 JSON  Summary 缺失时的 pnpm 包装问题）。
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

## 5. 当前基线

- **M1 定版冻结于 `a9f4bab`**；M2 首个投递批次起点 = `a9f4bab`

### M2 已落地（自 `a9f4bab` 起）
| commit | 内容 |
|---|---|
| `f886712` | 禁用词门禁单一真源（`scripts/forbidden-words.ts`）+ ATTRIBUTION 生成器修正 + CI 守卫 2b/3b |
| `5a71662` | 领域层 `sectionPlan` / `grader` / `result` + 测试（= T-M2-01） |
| `0725639` | 增量 PRD v1.2 + 增量设计 v1.2 + `docs/02` v1.6 |
| `379376e` | 决策留痕与本 skill |

- **`sectionMeta` 驱动契约（K1–K3）**：板块渲染 / 总时长 / 题号区间的唯一来源均为 `plan`；
  恢复听力只需改 `DEFAULT_DISABLED_SECTIONS`，**零业务代码改动**（由往返单测守护）
- **B6 存疑分流**：`doubtful` 与 `wrongQuestionIds` 严格互斥（错误的标准答案进 FSRS 会永久污染调度）；
  优先级 `doubtful > blank > wrong > marked > correct`；`marked`（答对但标记待定）**仍计入分子**
- **零总分**：`ExamResultView` 结构上**不提供总分字段**（防呆优于文案提醒）；分母为 0 返回 `null` 而非 `0%`
- **B-Q2 零迁移**：`git diff a9f4bab..HEAD --name-only` 不得出现 `types.ts` / `db.ts` / `migrations.ts` / `speech/*`
  ⚠️ `types.ts:254` 注释里的 `710 分制换算` 因不邻接而**不命中**门禁，属既有代码，**不要改**（改了就违反 B-Q2）

- FSRS：`Again` 保留 ts-fsrs 原生落点再以 `Hard` 的 due **钳制** → 新卡 Again=**60s**、成熟卡 Again=**600s**；不调 ts-fsrs 全局参数
- `waiting` 相位：**队列暂空 ≠ 今日完成** —— 队内 `notBefore` 未到 / 库中 60s 内临期卡 → 显示倒计时，绝不静默完成
- `settle()` 只以**队首** `queue[cursor]` 是否被 `notBefore` 门控判定；进入 waiting 前门控块按 `notBefore` 升序排序
- 待答区（`i > cursor`）同词唯一；队列长度随 Again 线性增长（已接受）
- 已知口径：库中临期卡 `due ∈ (60s, ∞)` 时 `start()` 判 `empty`

## 6. 收尾清单

- [ ] `git status --porcelain` 为空（memory 笔记除外）
- [ ] 根目录 / `tests/` / `.workbuddy/` 无 `_*` 临时文件；探针只写 `%TEMP%` 并删净
- [ ] HEAD 明确钉在某个 commit（「冻结于 <hash>」）
- [ ] 门槛六命令实测输出 + 遗留清单（含严重度）
- [ ] **提交前再跑一次** `pnpm exec tsx scripts/check-forbidden-words.ts`（见 §2.8，顺序错了等于没跑）
- [ ] ATTRIBUTION 幂等：`pnpm data:attribution && git diff --exit-code public/data/ATTRIBUTION.md`
- [ ] 零迁移 B-Q2：`git diff a9f4bab..HEAD --name-only` 无 `types.ts`/`db.ts`/`migrations.ts`/`speech/*`
- [ ] 把结论与教训追加到 `.workbuddy/memory/YYYY-MM-DD.md`
