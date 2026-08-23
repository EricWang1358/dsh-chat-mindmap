# S2（Phase 2 · Generation Orchestration）阶段报告

- 依据：`docs/plans/S2_PLAN_v3.md` 任务 S2-W0 … S2-W7
- 执行日期：2026-08-23
- 区间：S1 收尾提交 `ec6e00d` → 本报告提交

## 1. 变更清单（按 WBS）

| WBS | 提交 | 内容 |
|---|---|---|
| S2-W0 | `1236403` | S2_DEVIATIONS.md：工区对账映射（D-S2-1）、常量规范化副本（D-S2-2）、测试链位次（D-S2-3）、F-2 maxTokens 源码核实结论 |
| S2-W1 | `2338a46` | `src/host/generation-locks.ts`：libraryId 互斥锁＋accepted→running→五终态状态机；非法跃迁 INVALID_REQUEST；release 幂等 |
| S2-W2 | `5a83e3c`+`7d3aba5` | executor 管线：selectProvider 三分支表驱动、GENERATION_MAX_TOKENS=6000 断言、OUTLINE_OUTPUT_SCHEMA/OUTLINE_PERSONA 规范副本、RC8_START_KEYS 白名单断言、strict outline 透传 truncated |
| S2-W3 | `a993d00` | GENERATION_TIMEOUT_MS===180_000 可注入；timed_out 标志置位优先定类；dispose 四路径恰好一次 |
| S2-W4 | `c738f43` | commitGenerationOutcome：CAS 漂移→MINDMAP_CONFLICT 且 sha256 不变；无效文档写前失败；completed-after-save 顺序断言（可注入 save）；reserveLibraryId 纯函数；library 冲突错误升级为 coded DomainError（消息逐字兼容） |
| S2-W5 | `4e7183c` | PanelRunRegistry：零 IO 面结构断言；getViewOrInterrupted→failed+『生成已中断』（INTERRUPTED_DETAIL 具名导出）；trackCompletion/disposeAll |
| S2-W6 | `f102a38` | createPanelGenerationAdapter（lock→registry→executor→commit 全流程）、createParentSideEffectProbe（panel 零发射证明）、createChatGenerationLauncher（jobs 缺席显式 CAPABILITY_UNAVAILABLE / 存在→background）；**abort-race 加固：所有 await 与 abortedPromise 竞速，预中止 controller 不再悬挂（DEV-S2-4）**；runId 追加随机后缀防跨 adapter 碰撞 |

## 2. 门禁结果（阶段末全量复跑）

```text
npm test                 # 15 段全 passed, exit 0
npm run typecheck        # exit 0
npm run build            # tgz 构建成功
npm run verify:sast      # passed（清单含全部 host/domain 模块）
npm run verify:package   # passed
npm run verify:bundle    # 170729 B gzip / 预算 204800 B
npm run verify:gate0     # exit 0；PENDING_LIVE = 3（设计允许）
```

可执行回滚验证：临时移出 `src/host/adapters.ts` 后 `verify:sast` 仍 exit 0，还原后复绿（W7 验收项实测通过）。

## 3. §18 自动化子集达成方式

| 指标 | 断言位置 |
|---|---|
| 同 map 并发 100% 拒绝或复用 | W1 tryAcquire 忙返回 null → adapter 映射 MINDMAP_BUSY |
| completed ⇒ 新 record 可读 | W4 orderedPending/save 注入顺序断言 + created 后 getMindmap 读回 |
| 任意失败旧 current 字节不变 | W4 sha256 前后相等（conflict 与 invalid 两路径） |
| 180s ± 2s 硬超时 | W3 常量恒等断言 + 注入短值行为断言 |
| 插件重载无悬挂 run/lock | W5 disposeAll 计数归零 + W1 终态释放后重获 |

## 4. 偏差摘要

- D-S2-1 工区对账（P3 地基映射 W2/W6）
- D-S2-2 schema/persona 常量规范化副本（index.ts 旧副本冻结，集成期删除）
- D-S2-3 host 测试链插位（引 D1 先例）
- DEV-S2-4 abort-race 加固（Promise.race 模式，预中止确定性分类）
- DEV-S2-5 过程记录：两次红测试误提交均即刻 fix-forward；根因管道吞退出码，已改显式 $LASTEXITCODE 校验
- F-2 maxTokens 传递通道悬置（rc8 公开面无此键，源码核实）

## 5. 过程发现的行为缺口

- F-1（沿用）：prompt 备注全部超预算时无缺失提示——集成期切换单一实现时统一修复。
- F-3（新登记，见 DEV-S2-4）：executor 对预中止 controller 的处理在修复前依赖 runtime 行为——已由 race 方案根治，无需 live 项。

## 6. 遗留风险与集成移交清单

**遗留风险**：R8 双路径并存至集成期；R9 rc8 dispose 幂等性待 live 复验；R11 新建图 absent 基线的残余竞态（锁内互斥＋接受限制）；R12 F-2。

**移交清单（集成 Agent）**：
1. `src/index.ts` 接线：inject 增补 jobs 能力探测、以 `createChatGenerationLauncher/createPanelGenerationAdapter` 替换冻结的 `startPanelRegeneration/regenerationPrompt/OUTLINE_SCHEMA/persona` 旧副本并删除；
2. 切换时执行 F-1 修复并同步更新 index.test.mjs 黄金断言；
3. REST 层暴露 restore/CAS 参数与错误码 HTTP 映射（Phase 3 范围）；
4. Live runbook 追加：maxTokens 传递方式核实（F-2/R12）、dispose 幂等性复验（R9）、30/120/300 校准证据（ADR-008）。
