# S4 计划 v3（定稿 · 唯一实施依据）

> v1（作者）→ CRITIC-R1 12 条全采纳 → v2 → CRITIC-R2 恰 3 条全采纳 → 本稿。
> 基线 b25f18b。上游：TECHNICAL_DESIGN §13–§15/§17.3/§18/§20 Phase 4/§21/§22＋S3 移交三项。

## A. 继承 v1/v2 的全部裁决

v1 全文（对账表、目标/非目标、W0(a)–(e)、WBS、B/C 节、提交切分）与 v2 修订（⟨R1-1⟩…⟨R1-12⟩ 全部采纳）合并为本计划正文；冲突时以本节 A.1 补充为准。

### A.1 W1 执行序列与回滚单位 ⟨R2-1⟩

W1 内部固定五步，不得倒置、不得部分提交：(1) 《新旧断言映射表》骨架入提交说明草稿；(2) `src/index.ts` 一次成型重写为装配面（tools/routes/panel-runs/adapters 接线＋可选 inject＋settings 包装器占位＋F-1 修复）；(3) 重写 `tests/index.test.mjs` 至 canonical 断言集；(4) F-1 表驱动用例补齐；(5) 三门禁全绿→单提交。回滚单位＝整个 W1 提交（git revert 后工区必须回到 b25f18b 语义等价态）。提交 diff 触及白名单外文件即自判失败。

### A.2 测试文件分片 ⟨R2-2⟩

新增测试一律独立文件，插链于 integration 之后、index 之前（package.json scripts.test 顺序）：`card → dialog → integration → client-ia → client-ui → client-perf → locale → settings → index`。每片可独立 `node tests/<file>` 执行；任何前缀回滚时对应插链条目与文件同进同退；verify-sast 文件清单同步增删。

### A.3 断言锚点表 ⟨R2-3⟩

| §17.3 条目 | 锚点 |
|---|---|
| session/workspace 范围切换 | client-ia.test.mjs::listQueryOf 切换表＋scope 包装器单测 |
| 只有一个主要重新生成按钮 | client-ui.test.mjs::renderToStaticMarkup 计数 role=button[data-primary-regenerate]===1 |
| 生成中禁用同 map 再生成 | client-ia.test.mjs::FakeApi running 态渲染 disabled 属性存在 |
| completed 刷新 record；failed 保留旧 current | client-ia.test.mjs::FakeApi 两态序列断言 record 引用 |
| restore 菜单仅在有 previous 时出现 | client-ui.test.mjs::hasPrevious 菜单项条件渲染两态 |
| 设置修改不改已有 map | settings.test.mjs::既有 PATCH 不经 resolveNewRecordConfig＋config 逐字段不变 |
| 卡片四态 | card.test.mjs（S3 已锁，回归） |
| dialog Esc/焦点恢复 | dialog.test.mjs（S3 已锁）＋live PENDING_LIVE |
| 字典零缺键；未知 locale 回退英文 | locale.test.mjs::双向键集相等＋createT('fr') 回退 en |
| 窄屏无横向溢出 | client-ui.test.mjs::narrowLayoutUsesSelector 锚点＋live PENDING_LIVE |

空状态三分支锚点：client-ia.test.mjs::emptyStateBranch（session 空/workspace 空/CAPABILITY_UNAVAILABLE 各一 renderToStaticMarkup 断言）。

## B/C 节

继承 v1 第 4/5 节全文（含 R14–R18 与门禁矩阵、PENDING_LIVE 纪律、显式路径 add）。DEVIATIONS 随任务提交维护（⟨R1-9⟩）。

## 实施声明

本稿为 S4 唯一实施依据。实施中不合理处记入 docs/plans/S4_S5_DEVIATIONS.md（偏差/原因/备选对比/最优解理由）；触及验收标准或产品约束时先回退修订本稿再继续。
