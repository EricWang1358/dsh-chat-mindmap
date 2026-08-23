# S2 偏差决策记录

按 `docs/plans/S2_PLAN_v3.md` 偏差协议维护。每条含：偏差/原因/备选对比/结论。

## D-S2-1（W0）：工区既有实现对 WBS 的映射

- **现状**：`src/host/generation-executor.ts` 与 `tests/host.test.mjs` 已存在，但为 P1–P3 裁决的 P3 交付（提交 1b45e56），仅含 `buildRegenerationPrompt` 及其测试；无未提交实现。
- **映射**：该文件是 S2-W2 的地基（模块载体）；tests/host.test.mjs 即 B 节所述 host 测试文件。本计划不重建、只扩展。
- **结论**：非静默沿用——映射公开登记；W2 起新增导出均按 v3 导出断言验收。

## D-S2-2（W2）：OUTLINE_SCHEMA/PERSONA 常量规范化副本

- **偏差**：两常量现行于冻结的 `src/index.ts`；executor 需要同一值。§4.1 禁止复制 prompt/保存逻辑，schema/persona 属 prompt 组成部分。
- **备选**：(a) 从 lib/index.js 运行时反取——不可行，未导出；(b) executor 内重新字面定义并声明为唯一规范副本（采纳）；(c) 等集成期一并搬移——S2 测试将无锚点。
- **结论**：采纳 (b)，模式同 P3：新模块为唯一规范实现，index.ts 旧副本冻结废弃，集成期切换删除；等价性由 index.test.mjs 既有断言（toolFilter 深比较、prompt 全文）锁定。

## D-S2-3（B 节）：host 测试插入 test 链位次

- **偏差**：package.json `scripts.test` 插入 `node tests/host.test.mjs` 于 domain 之后、index 之前。
- **备选**：(a) 并入 domain.test.mjs——职责混杂；(b) 独立文件＋插链（采纳）。
- **结论**：采纳 (b)，引 D1 先例（单 Agent trunk 无冲突面，不新增依赖）。已于 P3 提交先行落地。

## F-2（R12）：maxTokens 传递方式悬置

- **事实**（源码核实 2026-08-23）：`dsh-subagent-fork-in-process@0.1.0-rc.8` README 与 `scripts/gate0.mjs` 契约键中均无 maxTokens/max_tokens 引用。
- **处置**：`GENERATION_MAX_TOKENS=6000` 常量化（ADR-008）并由测试断言；真实传递通道归集成期 live 接线验证；在此之前禁止向 start() 传非契约键。

## DEV-S2-x（实施期追加区）

（随实施追加）
