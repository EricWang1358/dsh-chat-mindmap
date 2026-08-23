# S4 阶段报告

依据 `S4_PLAN_v3.md`（v1→R1×12→v2→R2×3）；基线 b25f18b → 本阶段末端。测试链终序：core→library→domain→host→tools→routes→card→dialog→integration→client-ia→client-ui→client-perf→locale→settings→index（index 恒末位）。

## 1. WBS × 提交

| 任务 | 提交 | 内容 |
| --- | --- | --- |
| W0 | `e774bf7` | 计划 v1–v3＋设计增量评审＋DEVIATIONS 开立；前置核查 core.ts 同构 ✓、routes scope ✓、rc8 primitives 缺位实证 |
| W1 host 切换 | `a76922b` | index.ts 装配化（585→164）；tools/routes/panel-runs/adapters 接线；F-1 核销；黄金断言重写（映射表见提交说明）；D-S4-1 begin/settle 加法分解落实 §11 立即 runId |
| W2 client IA | `037dfea`+`044351d` | api.ts（ApiError 信封/listQueryOf）、session/workspace 切换、空状态三分支、窄屏选择器、mutation 全量 expectedRecordVersion＋409 刷新、本地构建经 POST /maps、restore/归档/删除、regenerate 三要素 Modal、唯一主按钮断言 |
| W3 primitives | `195104c` | ui/primitives 七件套（token-only、ARIA）；canvas-theme 抽离＝D-S3-9 收敛；check-tokens 门禁＋豁免注册表 |
| W4 性能红线 | `578529a` | eager XMind 删除、mountKeyOf 纯函数、autosave 序号＋AbortController、benchmark.mjs＋docs/evidence JSON（360 节点管线各 <10ms） |
| W5 settings | `e0aa556` | chat-mindmap namespace（schemastery＋base=编译默认＋live）、capabilities.settings、effectiveConfig defaults 参数（§7 合并）、POST /maps 包装合并；客户端 MindmapSettingsCard 经官方 plugins.tab slot，缺席即降级 |
| W6 i18n＋降级 | `9d11853`+`1b46f43` | locale.ts zh/en 字典、createT/resolveLocale、EmptyState 接入；tests/locale.test.mjs §15 六行矩阵 |
| W7 sast＋报告 | 本提交 | verify-sast 清单 += 7 新文件；容错复验（移出 locale.ts → 绿 → 还原 → 绿）|

## 2. 门禁矩阵（每波次实测 exit 0）

npm test（15 组套件）/ typecheck / build / verify:gate0 / verify:sast / verify:package / verify:bundle —— W7 阶段末全绿；各任务提交点均过三门禁。

## 3. §17.3 十条断言结果（锚点表见 S4_PLAN_v3 A.3）

范围切换 ✓(listQueryOf 表)、唯一主 regenerate 按钮 ✓(data-primary 计数=1)、生成中禁用 ✓(predicate)、completed/failed 语义 ✓(FakeApi)、restore 条件渲染 ✓(previous 锚点)、设置不改既有图 ✓(effectiveConfig 表＋PATCH 直通)、卡片四态 ✓(S3 回归)、dialog Esc/焦点 ✓(S3 回归＋live PENDING_LIVE)、字典零缺键＋未知回退 ✓、窄屏无溢出 ✓(锚点)＋视觉 PENDING_LIVE。

## 4. 性能证据

- `docs/evidence/S4-perf-benchmark.json`：360 节点合成图，buildMindmap≈4.5ms／validate≈0.33ms／toMarkdown≈0.2ms／serialize≈0.13ms（node 22 win32）。
- PENDING_LIVE：画布交互 <1s、SVG 生成 <1s（runbook：DSH web 内 performance.mark 包裹 MindMap 构造与 doExport('svg')，普通桌面环境三次取中位）。

## 5. 偏差摘要

D-S4-1 begin/settle 加法分解；D-S4-2 F-1 黄金断言反转；D-S4-3 WBS 编号映射＋MapCanvas/MapList 暂不拆文件（W3 重写期处理，实际随本报告关闭）；D-S4-4 长行读改写管线教训（node 脚本批量＋单点 edit）。

## 6. 遗留风险 / PENDING_LIVE

R11/R12 继承未触发；live runbook 四项（launcher 全链路真机、panel 取消、卸载归零文案、设置卡在真实 settings UI 的读写往返）＋macOS 实机 smoke——统一移交 Phase 4.5/5 runbook 执行窗口。

## 7. Phase 4.5 移交清单

1. 入口：`src/domain/mindmap-doc.ts`（规范化 schema）、`src/host/export/print-html.ts`＋`themes.ts`（A3 打印 HTML＋四风格预设）、`src/client/export/*`（Blob 装配＋预览打开）、`src/domain/quiz.ts`（四题型 schema＋答案一致性）。
2. 已验证事实：core.ts 同构可被 export 复用；verify-sast 文件级豁免机制就绪（artifact 模板）；check-tokens 门禁可直接纳入 export 测试。
3. 契约提醒：导出 HTML 必须全量 escape 且自包含；题目导出前必经预览状态机；性能证据沿用「预算估算 JSON＋浏览器 PENDING_LIVE」双轨。
4. 版本仍冻结 0.1.4；0.2.0 发布动作待人工确认（S5-W5）。
