# S2（Generation Orchestration）实施计划 v1

> 状态：v1（待 CRITIC-R1 ≥8 条评审）
> 依据：设计文档 §9/§18/§20-Phase2、`docs/plans/S2_DESIGN_DELTA_REVIEW.md`（P1–P3+ADR-008）、`scripts/gate0.mjs` rc8 契约键
> 基线：commit `1b45e56`，全门禁绿
> 工区对账：`src/host/generation-executor.ts`（仅 buildRegenerationPrompt）与 `tests/host.test.mjs` 为 P3 已提交产物，映射至 W2/W6 的地基，登记于 `docs/plans/S2_DEVIATIONS.md` D-S2-1

## 1. 目标与非目标

### 目标
- G1：GenerationLockRegistry——libraryId 互斥锁＋六态状态机全分支可测。
- G2：单一 GenerationExecutor——provider 三分支选择、rc8 契约键绑定、strict outline 管线、prompt 单一规范实现。
- G3：180s 默认超时（可注入）＋dispose 恰好一次＋锁在 finally 释放；cancelled/timed_out/failed 分类确定。
- G4：§9.1 提交事务边界——内存构造→CAS 提交；失败路径磁盘字节不变；completed 仅在保存成功后发布。
- G5：PanelRunRegistry——进程内、零 IO 面、「生成已中断」语义、disposeAll 取消并 await。
- G6：Chat/panel adapter 工厂——panel 对 parent 零发射证明；插件级接线移交集成阶段。
- G7：§18 自动化子集全部断言化；verify-sast 清单补齐并保持任意前缀 revert 安全。

### 非目标
- N1：不改 `src/index.ts`、`src/client/**`；不注册 REST 路由与 host tools（P2 冻结规则）。
- N2：不接真实 ctx.subagents/jobs；不实现 Job 完成通知链（tool-jobs 属集成期接线）。
- N3：不做 UI 状态渲染、SVG 卡、DTO 收敛（Phase 3/4）。
- N4：不引入依赖/测试框架；不修改 §16 错误码枚举。
- N5：maxTokens 不传给 rc8 start()——gate0 与 rc8 README 均无该键（源码核实），常量先行（F-2 登记）。

## 2. WBS

复杂度 S/M。每任务：失败测试→实现→build→目标测试绿→npm test && typecheck && build→提交（feat(host)，正文 Refs: S2-Wx，含 -f lib 产物同步）。

| 编号 | 任务 | 输入 | 改动 | 关键验收（机器可判，Given/When/Then 细化见 v3） |
|---|---|---|---|---|
| S2-W0 | 增量评审核对 | S2_DESIGN_DELTA_REVIEW | docs/plans/S2_DEVIATIONS.md 新建 | P1–P3 结论可追溯；工区对账条目落盘；第 2 节零改动（git diff 断言） |
| S2-W1 | generation-locks.ts | §9.1/9.2 | 新增模块+测试 | Given 同 map 已持锁；When tryAcquire；Then null（调用方映射 MINDMAP_BUSY）。Given 异 map；Then 双获锁成功且事件序数组确定性记录并行。状态机 accepted→running→{5 终态} 循环覆盖；非法跃迁/未知库抛 INVALID_REQUEST；release 幂等（二次 false）；终态后 release 再获锁成功 |
| S2-W2 | executor 管线 | §8.2–8.4、P3 | 扩展 executor 模块 | selectProvider 表驱动 5 例：{fork,spawn}×supplementalContext→fork/spawn(仅非空)/null；null→调用方 CAPABILITY_UNAVAILABLE。GENERATION_MAX_TOKENS===6000（ADR-008）。OUTLINE_OUTPUT_SCHEMA/OUTLINE_PERSONA 常量化为唯一规范副本（D-S2-2）。runOutlineGeneration happy path：fake start 请求键集 ⊆ gate0 契约键 {label,prompt,parent,signal,outputSchema,maxDepth,toolFilter,persona} 且 toolFilter≡{allow:[]}、maxDepth===1；structured 经 validateAgentOutlineResult+buildStrictOutlineDocument；stopReason≠completed→failed(安全 diagnostic)；truncated 透传 |
| S2-W3 | 超时与清理 | §9、§18 | 扩展 executor | GENERATION_TIMEOUT_MS===180_000；timeoutMs 可注入。deferred fake 三路径：超时 abort→timed_out；外部 controller.abort→cancelled（先于结果）；result reject→failed。每路径 dispose 计数===1；finally 清 timer |
| S2-W4 | 提交事务边界 | §9.1、S1 CAS | 扩展 executor + domain/records reserveLibraryId | commitGenerationOutcome：基线版本存在→saveMindmap 带 expectedRecordVersion；手动编辑致版本漂移→拒绝 'mindmap conflict' 且磁盘 sha256 前后相等；无效文档→写前抛错、哈希不变；reserveLibraryId(now,hex) 纯函数格式 ^map-[0-9a-z]+-[0-9a-f]{12}$；completed outcome 仅在 save resolve 后返回（结构顺序保证+测试断言） |
| S2-W5 | panel-runs.ts | §9.2 | 新增模块+测试 | 进程内 Map；构建产物源码不含 node:fs/require( 结构断言（零 IO 面）；getViewOrInterrupted(未知 runId)→detail===INTERRUPTED_DETAIL('生成已中断')；disposeAll abort 全部 controller 并 await trackCompletion 注册的 promise |
| S2-W6 | adapter 工厂 | P2 | 新增 host/adapters.ts + 测试 | createPanelGenerationAdapter 全流程：lock→registry→outline→commit→视图更新；parent 探针（tools/messages 计数）全程===0；createChatGenerationLauncher：jobs 缺席→CAPABILITY_UNAVAILABLE，jobs 存在（fake）→background 模式返回 jobId；第二运行进行中调 disposeAll→cancelled 且 await 完成 |
| S2-W7 | 收尾 | 全部 | verify-sast 清单+阶段报告 | sast 含 locks/panel-runs/adapters；任意前缀 revert 后脚本仍绿（existsSync 容错复验）；七门禁矩阵；遗留风险＋集成移交清单 |

## 3. 测试与门禁策略（B 节）

- TDD 循环同 S1；host 测试插入链中 domain 之后、index 恒末位（沿用 D1 先例，登记 D-S2-3）。
- Fake 契约绑定：测试内 `RC8_START_KEYS` 白名单 helper，任何请求键出界即失败——防 fixture 漂移。
- §18 断言化子集：同 map 并发 100% 拒绝（W1）；completed⇒record 可读（W4）；任意失败旧 current 字节不变（sha256，W4）；180s 常量（W3）。
- 门禁：每任务 test/typecheck/build；阶段末 gate0/sast/package/bundle。
- 回归网：tests/index.test.mjs 冻结不动但持续绿。

## 4. 回滚与风险增量（C 节）

全部新增模块，index.ts/client 零触碰→任意前缀 revert 安全；package.json/sast/lib 产物三件套随任务提交成对回滚（检查单写入每任务 DoD）。

| 编号 | 风险 | 缓解 |
|---|---|---|
| R8 | 双路径行为漂移（旧 startPanelRegeneration vs 新 adapter） | 旧路径冻结禁改；集成删除清单入阶段报告 |
| R9 | rc8 dispose 幂等性未知 | executor 内 once-guard；live runbook 复验项 |
| R10 | 校准缺失 | ADR-008 常量化＋测试断言值 |
| R11 | 新建脑图首次提交无基线版本的残余竞态 | 锁互斥生成路径；manual POST 并发窗口登记为接受限制 |
| R12 | F-2：maxTokens 无法经 rc8 公开键传递 | 常量＋RunPlan 承载；真实传递方式归 live 接线验证 |

## 5. 提交切分

docs(plan) v1/v2/v3 → docs(deviation) 对账 → feat(host): lock registry (S2-W1) → …逐任务… → chore(sast)+docs(phase2) 阶段报告 (S2-W7)。每提交正文含 Refs: S2-Wx；lib 产物 -f 成对入库。
