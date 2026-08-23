# S4.5 计划 v3（定稿 · 唯一实施依据）

> v1 → CRITIC-R1 八条全采纳 → v2 → CRITIC-R2 恰三条 → 本稿。

## R2 三条意见与结论

### R2-1（粒度）：W2 print-html 是本阶段最大任务，需拆内部步骤。
**结论**：W2 内部固定四步：①themes.ts（预设对象）→②escapeHtml 三函数→③renderPrintHtml 主函数→④golden 测试。每步 typecheck 绿后再进下一步，整任务单提交。回滚＝revert 整提交。

### R2-2（机器可判）：「溢出报告」的测试断言需要精确口径。
**结论**：构造一个已知会溢出的 doc（单条目文本 5000 字符），断言 overflow 数组包含 {type:'width', path:'基准脑图 > 分支0', ...}；height 类似用 maxNodes=2000 的深树触发。不依赖视觉渲染高度——纯数据层判断基于字符数阈值（每条目 >500 字符标 width 溢出、每分支总子节点 >80 标 height 溢出），阈值作为常量导出供校准。

### R2-3（回滚成立）：quiz 预览状态机如果和 UI 组件耦合则无法独立回退。
**结论**：transitionQuizState 放在 domain/quiz.ts 与 React 零依赖，仅导出纯函数＋状态枚举。UI 绑定（如果有）放 client/export/ 且不在本阶段实施。

## 实施声明

本稿为 S4.5 唯一实施依据。不合理处记入 DEVIATIONS（D-S45-N）；触及验收标准先回退修订。

## 最终 WBS

| 任务 | 提交前缀 | 复杂度 |
|---|---|---|
| W0 | docs(plan) | S |
| W1 mindmap-doc | feat(domain) | M |
| W2 print-html | feat(export) | L |
| W3 quiz | feat(quiz) | M |
| W4 security | feat(security) | S |
| W5 skill | docs(skill) | S |
| W6 benchmark+报告 | chore(benchmark) | M |
