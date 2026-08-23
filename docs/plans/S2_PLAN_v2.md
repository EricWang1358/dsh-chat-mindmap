# S2（Generation Orchestration）实施计划 v2

> 状态：v2（CRITIC-R1 十条意见已回填：9 采纳 / 1 部分采纳 / 0 拒绝；附录 A）。待 CRITIC-R2 恰 3 条可执行性复审。
> 依据与工区对账同 v1。

## 1. 目标与非目标

### 目标
- G1 锁注册表＋六态状态机全分支可测；非法跃迁抛 `INVALID_REQUEST`（消息固定 `invalid generation state transition`，不含库 id/路径）。
- G2 单一 executor 管线：provider 三分支、rc8 契约键白名单绑定、strict outline、prompt/schema/persona 单一规范副本。
- G3 超时可注入默认 180_000；**timed_out 优先于 cancelled**（超时标志置位即定类，双触发确定性）；dispose 恰好一次覆盖 success/timeout/cancel/error 四路径。
- G4 §9.1 事务边界：基线版本存在→CAS 提交；**基线缺席（新建图）→不传 expectedRecordVersion，仅靠锁互斥（R11）**；completed 仅在 save resolve 后发布。
- G5 PanelRunRegistry：零 IO 面；**中断视图 status='failed'+detail='生成已中断'，禁止新增枚举值（§9.2 五态封闭）**。
- G6 adapter 工厂：依赖以纯函数接口注入（`promptSourceOf`/`baselineVersionOf`）；panel 零发射证明；disposeAll 取消并 await。
- G7 sast 补齐＋阶段报告＋集成移交清单。

### 非目标
N1 不改 src/index.ts、src/client/**；不注册路由/tools。N2 不接真实 ctx 服务与 tool-jobs 通知链。N3 UI/SVG/DTO 归 Phase 3/4。N4 无新依赖、不改 §16 枚举。N5 maxTokens 不传 rc8（F-2，源码核实无此键），常量先行。

## 2. WBS

复杂度 S/M；TDD＋单提交；提交正文 Refs: S2-Wx；**每任务 DoD 行末三件套成对检查：(lib 产物 -f)＋(触及链则 package.json)＋(触及源则 sast 清单)**。

| 编号 | 任务 | 输入 | 改动 | 关键验收 |
|---|---|---|---|---|
| S2-W0 | 增量评审核对＋对账登记 | delta review | S2_DEVIATIONS.md | D-S2-1 映射既有 host 地基；P1–P3 可追溯；§2 零改动 |
| S2-W1 | generation-locks.ts | §9 | 新模块+测试 | tryAcquire 忙→null；异 map 双获锁＋事件序数组确定性并行记录；accepted→running→五终态循环全覆盖；非法跃迁/未知库 throw INVALID_REQUEST('invalid generation state transition')；release 二次调用 false；终态释放后可重获 |
| S2-W2 | executor 管线 | §8.2–8.4 | 扩展 executor | selectProvider 5 例表驱动；MAX_TOKENS===6000；schema/persona 常量≡规范副本；runOutlineGeneration happy path 请求键集 ⊆ {label,prompt,parent,signal,outputSchema,maxDepth,toolFilter,persona} 且 toolFilter≡{allow:[]}、maxDepth===1；stopReason≠completed→failed；structured 校验失败→failed(diagnostic=Error.message 截断 500)；truncated 透传 |
| S2-W3 | 超时清理 | §9/§18 | 扩展 executor | TIMEOUT_MS===180_000；deferred fake：timed_out（标志置位定类，先于外部 abort 亦然）、cancelled（外部 abort 先于超时）、failed(reject)；四路径 dispose 计数===1；finally 清 timer；锁由调用方 finally 释放（W6 组合验证） |
| S2-W4 | 事务边界 | §9.1 | executor + records.reserveLibraryId | CAS 漂移→'mindmap conflict' 且 sha256 不变；无效文档→写前失败哈希不变；absent 基线创建成功且格式 ^map-[0-9a-z]+-[0-9a-f]{12}$；completed-after-save 顺序断言（save deferred resolve 后 outcome 才可得） |
| S2-W5 | panel-runs.ts | §9.2 | 新模块+测试 | 构建产物源码结构断言无 node:fs/require(；getOrInterrupted detail==='生成已中断' status='failed'；register/update/get 往返；trackCompletion+disposeAll：abort 全部并 await 未决 promise（计数归零） |
| S2-W6 | adapters.ts | P2 | 新模块+测试 | panel 全流程 lock→registry→outline→commit→视图；parent 探针 tools/messages 计数全程 0；chat launcher：jobs 缺席→CAPABILITY_UNAVAILABLE，fake jobs→background+jobId；第二运行中 disposeAll→cancelled 且 await 完成 |
| S2-W7 | 收尾 | 全部 | sast+报告 | 清单补齐 locks/panel-runs/adapters；existsSync 容错复验；七门禁矩阵；遗留风险＋移交清单（inject 接线、旧副本删除、F-1/F-2/R9 live 项） |

## 3. 测试与门禁策略（B）

- TDD 同 S1；host 测试位于链中 domain 后、index 恒末位（D-S2-3，引 D1）。
- `RC8_START_KEYS` 白名单断言 helper 固化于 tests/host.test.mjs 顶部具名工厂（Phase 3 出现第二消费者时再外移 helpers 文件）。
- §18 断言子集：并发拒绝(W1)、completed⇒可读(W4)、失败字节不变(W4)、180s 常量(W3)。
- 门禁序列同 S1；index.test.mjs 冻结绿。

## 4. 回滚与风险（C）

新增模块任意前缀 revert 安全；三件套成对规则入每任务 DoD。风险表：R8 冻结+删除清单；R9 once-guard+live；R10 ADR-008 断言；R11 absent 基线残余竞态（接受限制，登记）；R12 F-2 传递方式归 live 接线。

## 5. 提交切分

docs(plan)v1/v2/v3 → docs(deviation)W0 → feat(host)×6（W1–W6，各含 -f lib）→ chore(sast)+docs(phase2) 报告（W7）。

---

# 附录 A：CRITIC-R1 意见与处理结论（10 条）

| # | 问题→建议 | 优先级 | 结论 |
|---|---|---|---|
| 1 | executor 跨任务增长无导出面定义→逐任务列 export 清单 | High | 采纳：并入 R2 精化（v3 附录 B-1 一并固化） |
| 2 | timed_out/cancelled 双触发优先级缺失→标志置位定类＋测试锁定 | High | 采纳：G3/W3 已写入 |
| 3 | 非法跃迁处理动作未定义→INVALID_REQUEST 固定消息 | High | 采纳：W1/G1 |
| 4 | release 幂等语义含糊→boolean、未知 false | Medium | 采纳：W1 |
| 5 | 中断视图造新枚举态风险→status='failed'+detail，五态封闭 | High | 采纳：W5/G5 |
| 6 | fake helper 内联漂移→独立 helpers 文件 | Medium | 部分采纳：具名工厂＋常量留测试文件顶；外移推迟至出现第二消费者 |
| 7 | absent 基线 CAS 行为未写全→存在才传版本，缺席走锁＋R11 | High | 采纳：W4/G4 |
| 8 | adapter 注入形状不可判→两纯函数接口字段 | High | 采纳：W6/G6 |
| 9 | diagnostic 安全化规则缺失→Error.message 截断 500，路径过滤归上层并登记 | High | 采纳：W2 |
| 10 | 回滚三件套未落任务 DoD→行内成对检查 | Medium | 采纳：§2 引言 |
