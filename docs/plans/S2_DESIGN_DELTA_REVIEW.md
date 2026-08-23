# S2 设计增量评审与前置裁决记录

- 性质：Phase 2（Generation Orchestration）开工前的设计增量评审，对应计划骨架任务 S2-W0
- 输入：`docs/TECHNICAL_DESIGN_AND_IMPLEMENTATION_PLAN.md`、`docs/PHASE_0_GATE_0_EVIDENCE.md`、S1 阶段报告、v3 计划纪律
- 结论：三项全部裁决完毕并落盘（两项修订设计文档、一项代码落地），**无剩余阻塞项，S2 可进入计划迭代**

## P1：maxTokens 校准证据缺失

- **问题**：§8.3 要求 `maxTokens` 固定上限「初始建议 6000」并以 Gate 0 的 30/120/300 节点样本校准，但 `PHASE_0_GATE_0_EVIDENCE.md` 结果表没有任何校准记录；若按字面执行，Phase 2 验收将永远缺一项证据。
- **影响**：验收门不可判定；或被迫在自动化门禁中伪造「校准通过」。
- **备选方案对比**：
  1. 先跑校准再开工 —— 需要真实 LLM 大量生成样本，属 live 证据范畴，会无限期阻塞纯逻辑交付；
  2. 把 maxTokens 做成用户设置 —— 违反 §7「timeout、provider、persona、tool filter 与 token 上限不是用户设置；它们属于稳定性策略」；
  3. 编译期常量先行＋校准证据归入 live runbook（采纳）。
- **结论**：采纳方案 3，登记为 **ADR-008**。设计文档 §8.3 已同步改写；6000 以具名常量进入 executor，测试断言其值，未来校准只允许改常量并附证据链接。

## P2：Chat adapter 接线点与 §21 文件所有权冲突

- **问题**：聊天入口需要 owned Jobs（`ctx.jobs`），接入点在 `apply()` 的 `inject` 数组中；但 §21 规定 `src/index.ts` 由集成阶段统一修改。若 Phase 2 直接改接线，违反文件所有权规则；若不接，chat adapter 无法被真实调用。
- **影响**：交付形态歧义会导致实施期临时改规则或返工。
- **备选方案对比**：
  1. Phase 2 直接修改 index.ts/inject —— 破坏 §21，且让 Phase 3/4 的 diff 混入编排变更；
  2. Chat adapter 整体推迟到集成阶段 —— Phase 2 验收门「并发、超时、取消、dispose、失败不覆盖」就缺少 chat 侧证明；
  3. 工厂函数/纯装配模块＋fake 驱动测试，接线归集成（采纳）。
- **结论**：采纳方案 3，写入设计文档 §20 Phase 2 约束。配套两条硬规则：(a) S2 期间 `startPanelRegeneration` 旧路径冻结（禁止增强，仅允许随集成切换删除）；(b) adapter 模块必须暴露可被 `apply()` 一行调用的工厂接口，使集成期改动最小化。

## P3：regenerationPrompt 单一副本迁移

- **问题**：`regenerationPrompt()` 现存于 `src/index.ts`（约 360–376 行），而 §4.1 要求 chat/panel 共享同一 GenerationExecutor 且「不得复制 prompt 或保存逻辑」。S2 的 executor 需要该逻辑，但 index.ts 冻结。
- **影响**：直接复制会产生两份漂移副本，直接违反设计约束。
- **备选方案对比**：
  1. 复制进 executor，集成期再合并 —— 明确违反 §4.1；
  2. 仅写决策不动代码 —— S2 开工即依赖一份不存在共享实现的逻辑，等于未解决；
  3. 立即提取到新模块作为唯一规范实现，index.ts 旧副本冻结废弃、由既有 HTTP 黄金断言锁定行为，集成期一次性切换（采纳）。
- **结论**：采纳方案 3。落地为 `src/host/generation-executor.ts` 导出的纯函数 `buildRegenerationPrompt()`：消息文案逐字节保持现行输出（index.test.mjs 对 fork prompt 的全文断言即为切换时的等价性证明）；错误升级为 `DomainError('MINDMAP_NOT_FOUND','mindmap not found')`（message 不变）。同步纳入 verify-sast 清单（沿用 S1 M4 教训）。

## 设计文档修订清单（本次提交）

1. §8.3：maxTokens 条目改写为「编译期稳定性策略常量 6000（ADR-008），样本校准证据归入 live verification runbook」。
2. §24：追加 ADR-008。
3. §20 Phase 2：追加 P2 的两条交付约束（不改 index.ts/inject；旧路径冻结＋工厂化交付）。

第 2 节产品约束零改动。

## P3 落地过程中发现的行为缺口（F-1，登记不修复）

- **发现**：prompt 组装中「有 N 条节点备注未附带」的提示仅在至少一条备注幸存时渲染；当全部备注超预算被丢弃时（notes 为空 → nodeNoteSection 整体为空），模型收不到任何备注缺失信号。该行为在冻结的 `src/index.ts` 旧副本与新的规范模块中逐字节一致（提取保真性优先），非本次引入。
- **影响**：极端长备注场景下 prompt 透明度下降；不触犯第 2 节任何产品约束，也不影响现有黄金断言用例。
- **处置**：登记至集成阶段切换清单——切换到单一实现时在同一处补齐 else 分支提示，并同步更新 tests/index.test.mjs 黄金断言。在切换前禁止单边修改规范副本。
