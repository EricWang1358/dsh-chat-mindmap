# S4 计划 v2 — Brainmap UI 与 Settings UI

> 状态：v2（吸收 CRITIC-R1 十二条，采纳 12/12；修订处以 ⟨R1-n⟩ 标注）。实施依据以 v3 为准。

相对 v1 的增量修订（其余章节继承 v1）：

## W0 裁决增补

### (f) 本地文本创建的文档构建位置 ⟨R1-1⟩

开工前置核查 `src/core.ts` 零 node 专属导入（node:crypto/node:fs 等）。通过则客户端直接 import buildMindmap 构建文档后 POST /maps（bundle 内已有该模块路径，tsdown externals 不变）；不通过则回退裁决：index.ts 经 routes deps.saveRecord 无法承载构建，须在 W2 提交内登记偏差并启用最小 host 侧构建包装（仍在白名单文件内完成，不扩 routes.ts）。

### (g) 列表过滤的 host 适配 ⟨R1-2⟩

前置核查 routes.ts GET /maps 的查询参数语义。若 scope/sessionId 过滤不完备，在 index.ts 以 deps.listRecords 包装器翻译（scope=workspace ⇒ workspaceKey=workspaceKeyOfSession(sessionId)；session ⇒ sessionId 精确过滤），routes.ts 保持冻结；包装器表驱动直测。

## WBS 修订

### S4-W2 追加 ⟨R1-3⟩
- 读改写全部携带 expectedRecordVersion；409 MINDMAP_CONFLICT 时拉取最新 record 并提示（不做 last-write-wins）。conflictResolution 纯函数表驱动（409/成功/网络错误三态）。
- 窄屏交互以 §13.1 为准：<900px 列表折叠为 select 选择器，删除现 56px icon-rail 中间态 ⟨R1-11⟩。
- api.ts 提供 fetch seam：`createApiClient(fetchImpl)`；测试注入 FakeApi 驱动视图状态机断言（regenerate 进行中主按钮 disabled、completed 后 record 刷新、failed 保留旧 current）⟨R1-7⟩。
- svgPreviewHtml 移入 `src/client/preview/artifact-html.ts` 并进入色值扫描的**文件级**豁免白名单 ⟨R1-5⟩。

### S4-W5 修订 ⟨R1-4⟩
- settings 合并单点化：index.ts 仅包装「无 libraryId 的 save/saveRecord」调用为 resolveNewRecordConfig(scope.value, input.config)，显式断言替换而非叠加 effectiveConfig 结果；新增端到端用例：chat 新图 config == settings 合并值；既有图 PATCH 后 config 逐字段不变。

### S4-W6 修订 ⟨R1-6⟩
- locale.ts 导出 createT(localeId)（查表＋en 兜底）与 resolveLocale(ctxLocaleService|undefined, navigatorLanguage)（服务缺席→navigator→'en'）两个纯函数，表驱动直测；组件经 useT() 消费。

### S4-W4 修订 ⟨R1-8⟩
- scripts/benchmark.mjs 输出 JSON 至 `docs/evidence/S4-perf-benchmark.json`（合成 360 节点：buildMindmap/toSimpleMindMapData/markdown/serialize 四项耗时各跑 5 取中位）；画布交互与 SVG 生成的浏览器实测步骤、环境声明与预期输出写入 S4 阶段报告模板，标记 PENDING_LIVE。

### S4-W1 修订 ⟨R1-10⟩
- tests/index.test.mjs 重写前先留存全绿基线输出于提交说明；提交内附《新旧断言映射表》（删除/改写/新增三类逐条理由），作为 legacy 等价性的收口凭证。

## 流程修订

- DEVIATIONS 维护：每任务产生的偏差随该任务提交更新 `S4_S5_DEVIATIONS.md`，W7 报告汇总编号 ⟨R1-9⟩。
- 「恢复全局默认」＝restoreDefaultsOf(settings|null)：settings 可用回其值，缺失回 DEFAULT_MINDMAP_CONFIG；两态表驱动 ⟨R1-12⟩。

<!-- R2 三条见 v3 -->
