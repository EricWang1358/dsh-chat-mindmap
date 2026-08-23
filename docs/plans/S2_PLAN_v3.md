# S2 实施计划 v3（定稿 · 唯一实施依据）

> 状态：FINAL。R1 十条（附录 A 于 v2）、R2 恰三条（附录 B）均已回填。取代 v1/v2。
> 锚定：§9/§18/§20-P2、S2_DESIGN_DELTA_REVIEW、gate0 契约键；基线 `36de53a` 全门禁绿。

## 1. 目标与非目标

**目标**：G1 锁＋六态状态机；G2 单一 executor 管线（provider 三分支/契约键白名单/strict outline/规范常量副本）；G3 超时可注入默认 180_000、timed_out 优先定类、dispose 四路径恰好一次；G4 §9.1 事务边界（CAS/absent 基线规则/completed-after-save）；G5 PanelRunRegistry（零 IO、中断视图五态封闭）；G6 adapter 工厂（注入纯函数接口、panel 零发射、disposeAll）；G7 sast 补齐＋阶段报告＋移交清单。

**非目标**：N1 不改 src/index.ts 与 src/client/**，不注册路由/tools；N2 不接真实 ctx 服务与 tool-jobs；N3 UI/SVG/DTO 归后续；N4 无新依赖、不改 §16 枚举；N5 maxTokens 不传 rc8（F-2）。

## 2. WBS（TDD＋单提交；DoD 行末三件套：lib(-f)／package.json(触链)／sast(触源)）

| 编号 | 任务 | 输入 | 改动 | 验收（机器可判）与 **任务末导出面断言** |
|---|---|---|---|---|
| S2-W0 | 对账登记 | delta review、git log | 新建 S2_DEVIATIONS.md | D-S2-1：既有 generation-executor.ts(P3)↔W2 地基、host.test.mjs↔测试链位次；D-S2-2 常量规范化；D-S2-3 链插位（引 D1）；F-2 maxTokens（rc8 README/gate0 零引用，源码核实）。§2 零改动 |
| S2-W1 | locks | §9.1/9.2 | src/host/generation-locks.ts + tests | Given 已持锁 tryAcquire→null（映射 MINDMAP_BUSY 由调用方）；异 map 双获锁＋events[] 确定性并行序；accepted→running→{completed,failed,timed_out,cancelled} 循环全覆盖；非法跃迁→throw INVALID_REQUEST('invalid generation state transition')；release 幂等 boolean；终态释放后重获成功。**导出断言：GenerationRunState/LockEntry/GenerationLockRegistry** |
| S2-W2 | executor 管线 | §8.2–8.4/P3/F-2 | 扩展 executor | selectProvider 表 5 例；GENERATION_MAX_TOKENS===6000；OUTLINE_OUTPUT_SCHEMA/OUTLINE_PERSONA≡规范副本（D-S2-2）；runOutlineGeneration happy：请求键⊆RC8_START_KEYS、toolFilter≡{allow:[]}、maxDepth===1、signal 为 AbortSignal；stopReason≠completed→failed；structured 校验失败→failed(diagnostic=Error.message.slice(0,500))；truncated 透传。**导出断言：selectProvider/runOutlineGeneration/三常量/类型** |
| S2-W3 | 超时清理 | §9/§18 | 扩展 executor | GENERATION_TIMEOUT_MS===180_000 且为默认；deferred fake 三路径定类（超时标志置位优先于外部 abort）；dispose 计数 success/timeout/cancel/error 均===1；finally clearTimeout。**导出断言：GENERATION_TIMEOUT_MS** |
| S2-W4 | 事务边界 | §9.1/CAS | executor + domain/records.reserveLibraryId | commitGenerationOutcome：基线在→expectedRecordVersion CAS；版本漂移→'mindmap conflict'+sha256 相等；无效文档写前失败哈希不变；completed-after-save 顺序断言（deferred save）；reserveLibraryId(now,hex) 纯函数格式断言。**导出断言：commitGenerationOutcome** |
| S2-W5 | panel-runs | §9.2 | src/host/panel-runs.ts + tests | 构建产物源码无 node:fs/require( 断言；getOrInterrupted→status='failed'∧detail==='生成已中断'(INTERRUPTED_DETAIL 恒等)；trackCompletion/disposeAll abort 全部并 await 计数归零。**导出断言：PanelRunRegistry/INTERRUPTED_DETAIL** |
| S2-W6 | adapters | P2 | src/host/adapters.ts + tests | 注入接口 promptSourceOf/baselineVersionOf 纯函数；panel 全流程后 parent 探针计数===0；chat launcher jobs 缺席→CAPABILITY_UNAVAILABLE / fake jobs→background+jobId；运行中 disposeAll→cancelled 且 await 归零。**导出断言：createPanelGenerationAdapter/createChatGenerationLauncher/createParentSideEffectProbe** |
| S2-W7 | 收尾 | 全部 | sast 清单+报告 | 清单+=locks/panel-runs/adapters；可执行容错验证：临时移走 adapters.ts 跑 verify:sast 须 exit0 后还原；七门禁矩阵；报告含 R8–R12、F-1/F-2、集成移交清单 |

## 3. 测试与门禁策略（B）
同 v2 §3：TDD；链位 domain→host→index（D-S2-3）；RC8_START_KEYS 白名单工厂固化于 host 测试顶；§18 断言子集四处；index.test.mjs 冻结绿；每任务 test/typecheck/build，阶段末全矩阵。

## 4. 回滚与风险（C）
新增模块任意前缀 revert 安全；三件套成对入 DoD。R8 冻结+删除清单｜R9 once-guard+live 复验｜R10 ADR-008 断言｜R11 absent 基线残余竞态（锁内互斥+接受限制登记）｜R12 F-2 传递归 live 接线。

## 5. 提交切分
docs(plan)v1/v2/v3 → docs(deviation)(S2-W0) → feat(host)：locks(W1)/pipeline(W2)/timeout(W3)/commit(W4)/registry(W5)/adapters(W6)，各含 -f lib 产物 → chore(sast)+docs(phase2) 报告(W7)。

---

# 附录 B：CRITIC-R2 可执行性复审（恰 3 条，均已采纳）

| # | 视角 | 问题 | 建议→结论 |
|---|---|---|---|
| B-1 | 任务粒度/开工 | executor 模块跨 W2–W4 增长，「完成」无客观判据 | 每任务行末固化**命名导出断言**（node -e import 逐一检查），实施即验收 → 采纳（已入表） |
| B-2 | 验收机器可判 | 「生成已中断」若以字面量散落，Phase 4 无法恒等消费 | INTERRUPTED_DETAIL 具名导出＋恒等断言 → 采纳（已入 W5） |
| B-3 | 回滚成立性 | 三件套成对规则停留在文字，未验证 | W7 增加**可执行容错验证步骤**（移文件跑 sast 再还原），把回滚声明变成命令 → 采纳（已入 W7） |
