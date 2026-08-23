# S5 计划 — 打包兼容与发布 QA

> 三稿合一：v1 初稿 → R1 五条采纳 → v2 修订 → R2 恰三条 → 本稿为定稿。
> 基线：S4.5 末端。上游锚定 §21/§22/§20 Phase 5。

## R1 意见（五条全采纳）

1. W0 白名单审计应逐文件 diff 而非笼统"工区干净"——采纳，输出审计表。
2. verify-package 已迁移锚点（S4-W7），W1 只需确认 pack/体积报告——采纳。
3. CI workflow 无法在本机跑 macOS runner——CI 文件落盘但 macOS 标 PENDING_LIVE。
4. README 应含安装命令与最低版本——采纳。
5. Release Readiness 报告须含 ADR 索引——采纳。

## R2 三条意见

1. W0 与 W1 可合并为同一提交（审计通过即打包通过）——采纳。
2. smoke 证据以测试链全绿为主，§17.4 浏览器项标 PENDING_LIVE——采纳。
3. 版本号冻结至人工确认后才 bump——采纳。

## WBS

| 任务 | 内容 | 复杂度 |
|---|---|---|
| W0+W1 集成审计＋打包 | 白名单 diff 表；npm pack 体积报告；lib 完整性断言（verify:package/bundle）；peer/dev deps 终审 | M |
| W2 文档 | README 重写（安装/使用/最低版本/降级表/macOS 状态）| M |
| W3 CI | .github/workflows/ci.yml windows+macos matrix；Windows 路径静态断言 | S |
| W4 全量 smoke | §17.4 十二条逐条映射到自动化证据或 PENDING_LIVE | M |
| W5 Release Readiness 报告 | 门禁汇总/遗留风险/ADR 索引/PENDING_LIVE 清单；停机待人工 | S |

## 提交切分

1. chore(release): integration audit and packaging finalization (Refs: S5-W0/W1)
2. docs(readme): usage guide and compatibility matrix (Refs: S5-W2)
3. chore(ci): windows and macos workflows; path assertion gate (Refs: S5-W3)
4. docs(release): Release Readiness report; STOP for human confirmation (Refs: S5-W4/W5)
