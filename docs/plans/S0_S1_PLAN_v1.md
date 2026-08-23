# S0/S1 实施计划 v1

> 状态：v1（待红队第一轮评审）
> 依据：`docs/TECHNICAL_DESIGN_AND_IMPLEMENTATION_PLAN.md`（含 6b63014 的 §6.1 修订）、`docs/plans/S0_S1_DESIGN_REVIEW.md`
> 基线：commit `6b63014`，全部门禁绿
> 设计基线定位声明：设计文档自述为「历史设计基线 / 0.2.x 候选」（其第 3 行）；本计划在 trunk 上按 `0.2.0-dev` 演进实施 Phase 0/1，`0.1.x` 发布线冻结，不在本计划内发布任何版本。

## 1. 目标与非目标

### 目标
- G1（S0）：独立复跑 Gate 0 全部可自动化验证，确认证据文档与脚本输出一致，产出 S0 阶段报告并正式关闭 Phase 0。
- G2（S1）：交付 V2 记录模型：`schemaVersion/recordVersion/workspaceKey/previewCurrent/previewPrevious`，含 V1→V2 lazy 迁移与确定性 legacy revision id。
- G3（S1）：交付预览两代旋转、restore 原子交换 primitive，以及「手动编辑不旋转 previous/preview」的存储层强制。
- G4（S1）：交付 strict outline builder（§8.4 校验与规范化）。
- G5（S1）：交付 settings 领域模块（类型、默认值、校验、仅新建合并策略）与稳定错误码模块（§16）。
- G6（S1）：workspaceKey 规范化与哈希（Windows/macOS/Linux 样例覆盖，含 `\\?\` 前缀）。

### 非目标（Non-goals）
- N1：不修改 `src/index.ts` 与 `src/client/**`（§21 归集成阶段；Phase 1 明令禁止改聊天工具卡和主 UI）。
- N2：不做 `ctx.settings.register()` Host 接线（依赖 apply 装配层，归集成阶段；§15 已允许 settings 缺失时降级）。
- N3：不实现 GenerationExecutor、锁、panel runs、chat Job（Phase 2）。
- N4：不改 REST 路由形状、错误码 HTTP 映射（Phase 3）；library 层以 coded DomainError 表达。
- N5：不引入任何新 npm 依赖；不加测试框架（沿用裸 node assert）。
- N6：不做迁移向导、批量迁移、settings schema 版本化（设计明确首版不需要）。
- N7：不动 Gate 0 live 项（PENDING_LIVE 维持设计允许状态）。

## 2. WBS 任务分解

复杂度：S ≤ 半天，M ≈ 1 天。每任务 TDD：先写失败测试 → 实现 → `npm run build` → 相关测试绿 → 全门禁 → 提交。

| 编号 | 任务 | 输入文件 | 改动文件 | 验收标准（Given/When/Then） | 复杂度 |
|---|---|---|---|---|---|
| S0-T1 | Gate 0 独立复验与阶段收尾 | PHASE_0_GATE_0_EVIDENCE.md、scripts/gate0.mjs | 新增 docs/plans/S0_S1_STAGE_REPORT_S0.md | Given 基线 worktree；When 运行 `npm run verify:gate0`、`npm test`、`npm run typecheck`、`npm run build`；Then 全部退出码 0，G0 自动化项全 PASS，PENDING_LIVE 集合＝{G0-4-live,G0-5-live,G0-6-live} 且与证据文档一致，阶段报告含复现命令与结果表 | S |
| S1-W1 | 错误码模块 | 设计 §16；src/core.ts（消息惯例） | 新增 src/domain/errors.ts、tests/domain.test.mjs；package.json test 链追加（偏差 D1） | Given DomainError(code,message)；When 抛出并被 catch；Then `error.code`∈§16 枚举、message 与现行库消息逐字兼容（如 `mindmap conflict`），`npm test` 含新文件 | S |
| S1-W2 | settings 领域模块 | 设计 §7；src/library.ts DEFAULT_CONFIG | 新增 src/domain/settings.ts + 测试 | Given 合法/非法 settings 输入；When normalizeMindmapSettings；Then 输出符合 §7 接口且非法值回退编译默认值；resolveNewRecordConfig(settings,requestConfig) 仅用于新建合并、请求配置优先；Given 已有 record config；When 传入 resolveNewRecordConfig；Then 结果不被 settings 覆盖（纯函数证明，无 watcher） | M |
| S1-W3 | workspaceKey 规范化与哈希 | 设计 §6.2；评审 M5 | 扩展 src/domain/records.ts + 测试 | Given Windows（大小写混用、正反斜杠、`\\?\` 前缀、尾分隔符）、macOS/Linux 样例；When normalizeWorkspaceCwd(cwd,platform)+workspaceKeyOf；Then 同目录不同写法同 key（Win 32 hex 截断 sha256），跨平台样例互异，无 realpath 调用，纯函数无 IO | M |
| S1-W4 | V2 记录类型与 lazy 迁移 | 设计 §6.1/§6.3；修订后 revisionId 规则 | 扩展 src/domain/records.ts + 测试 | Given V1 记录 JSON（无新字段）；When migrateRecord；Then 内存补全 schemaVersion=2、recordVersion=1、workspaceKey='legacy-unscoped'、previewCurrent=快照(current)、legacy revision id=revisionIdOf(document) 且重复读取稳定；Given V2 JSON；When migrateRecord；Then 字段原样保留；migrate 为纯函数不触盘 | M |
| S1-W5 | 预览两代旋转与 restore primitive | 设计 §6.1 规则、§17.1 | 扩展 src/domain/records.ts + 测试 | Given 第 3 次 Agent 生成；When rotateGenerationSnapshots；Then current→previous、previewCurrent→previewPrevious、previewCurrent=新快照，第 1 代 revision 不再可寻址（仅两代）；Given restoreSwap；When 应用；Then 仅交换 current/previous，preview 两代引用不变；手动编辑路径（applyManualEdit）不触碰 previous/preview | M |
| S1-W6 | strict outline builder | 设计 §8.4；src/core.ts buildMindmapFromOutline | 新增 src/domain/generation.ts + 测试 | Given {title,outline}：title 空/>120、outline 空/>200000、无根或无子标题 → 抛 INVALID_AGENT_OUTLINE；合法输入 → 文档过 validateMindmapDocument、层级跳级规范化不丢根结构、超 maxNodes 截断时返回 truncated=true；不回退 transcript parser | M |
| S1-W7a | library 存储层 V2 写读贯通 | src/library.ts；W4/W5 primitives | 修改 src/library.ts + tests/library.test.mjs | Given 旧 V1 fixture 文件写入磁盘；When getMindmap/listMindmaps；Then 正常读取且返回结构含 V2 补全字段；When saveMindmap/updateMindmap 任意写；Then 落盘 JSON 含 schemaVersion/recordVersion/workspaceKey/previewCurrent 且全部 V1 必备字段语义不变（旧二进制可读的结构断言）；summary index 追加 workspaceKey 可选字段；原子写路径不变 | M |
| S1-W7b | recordVersion CAS + 手动编辑语义修正 + restore 出口 | src/library.ts；评审 M2/M3 | 修改 src/library.ts + tests/library.test.mjs | Given expectedRecordVersion 不匹配；When save/update；Then 拒绝且消息含 `mindmap conflict`，record 不变；成功写后 recordVersion 递增；Given PATCH 带 document 未传 rotatePrevious；Then previous/preview 不变（默认不再旋转，client :540 显式传 false 行为不变）；restorePreviousMindmap(id) 原子交换并可往返；expectedUpdatedAt 兼容路径回归通过 | M |
| S1-W8 | SAST 清单补齐与门禁矩阵复跑 | 评审 M4 | 修改 scripts/verify-sast.mjs | Given 新 domain 文件清单；When verify:sast；Then 扫描列表包含全部新增 src/domain/*.ts 且通过；全量 `npm test/typecheck/build/verify:*` 绿 | S |
| S1-W9 | S1 阶段报告与一致性核对 | 全部产物 | 新增 docs/plans/S0_S1_STAGE_REPORT_S1.md；必要时微修 README/设计文档过期描述 | Then 报告含变更清单、门禁结果表、遗留风险（R1/R3/R4）、移交建议；docs 与代码无矛盾陈述 | S |

## 3. 测试策略（TDD）

- 循环：写失败断言（tests/domain.test.mjs 或既有文件追加）→ 最小实现 → `npm run build` → `node tests/<file>.mjs` 绿 → 全量门禁。构建先行是纪律（评审 m2：本地测试跑 lib 产物）。
- 单测覆盖点（对齐 §17.1 的 Phase 1 子集）：workspaceKey 平台样例；V1→V2 lazy 迁移与确定性 legacy revision；预览两代旋转；手动 autosave 不旋转 previous/preview；restore 交换且 preview 引用不变；第三次生成后首代失效；strict outline 校验/截断/跳级规范化；settings 仅新建合并；recordVersion CAS。
- 集成覆盖点：library.test.mjs 扩展（V1 fixture 读、原子写、CAS 冲突、restore 往返、并发写队列回归保持）；index.test.mjs 不改动但必须持续绿（HTTP 行为回归网）。
- 门禁覆盖点：每任务提交前 `npm test && npm run typecheck && npm run build`；阶段末加 `verify:gate0/sast/package/bundle`。

## 4. DevOps 集成点

### 提交切分（Conventional Commits，trunk-based，一任务一提交）
- `docs(plan): ...` ×3（v1/v2/v3）
- `docs(phase0): close gate 0 with revalidation report`（S0-T1）
- `feat(domain): error codes`（S1-W1）… 每个 WBS 编号出现在 commit message 正文（如 `Refs: S1-W4`）
- `chore(sast): scan domain modules`（S1-W8）、`docs(phase1): stage report`（S1-W9）

### CI 门禁映射
本地门禁序列与 `.github/workflows/ci.yml` 一致（typecheck→tsc→tsdown→test→sast→package→bundle→gate0）；push 后由 CI 复证。

### 证据留存
对齐 `docs/PHASE_0_GATE_0_EVIDENCE.md` 惯例：阶段报告内嵌可复现命令块＋结果表＋证据边界说明；不声称未执行的验证。

### 回滚方案
- 任务级：任一 WBS 提交可独立 `git revert`（存储格式向前兼容为前提）。
- 存储级（R1）：V2 写入后回滚旧二进制，读取不受影响；旧二进制再写入会丢弃 V2 字段——发布冻结期内不接受混跑，风险登记并在阶段报告声明回滚窗口。
- 数据无需迁移脚本：lazy 迁移，revert 后 V2 文件仍被旧读取器接受（忽略未知字段）。

## 5. 计划内偏差预告（需红队裁决）

| 编号 | 偏差 | 备选方案对比 | 推荐 |
|---|---|---|---|
| D1 | package.json `scripts.test` 追加 tests/domain.test.mjs | (a) 追加链（清晰、零依赖）；(b) 断言塞入既有三文件（避免动 package.json，但职责混杂、Phase 2+ 复用差）。§21「package.json 由集成 Agent 统一修改」的动机是多 Agent 冲突规避，本仓库当前为单 Agent trunk，冲突面不存在 | 采纳 (a) |
| D2 | S1 不接线 ctx.settings.register | (a) 本阶段接线（需动 src/index.ts，违反 §21 与 Phase 1 禁区）；(b) 纯模块＋非目标声明 | 采纳 (b) |

## 6. 风险登记册

| 编号 | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 回滚后旧二进制写坏 V2 字段（评审 M3） | preview 快照丢失 | 结构兼容断言测试锁定 V1 必备字段；阶段报告明示回滚窗口；发布冻结 |
| R2 | 本地陈旧 lib 导致测试假绿（评审 m2） | 缺陷漏检 | TDD 循环强制先 build；CI 顺序天然正确 |
| R3 | Windows 路径边界（`\\?\`/UNC）哈希分歧（评审 M5） | 同 workspace 双 key，隔离失真 | 规范化规则＋平台样例单测进 W3 验收 |
| R4 | GET /maps 直接返回 record，V2 字段使响应体积约增至 2~3 倍 | 面板加载变慢 | Phase 3 DTO 收敛；本阶段记录基线体积对比进阶段报告 |
| R5 | rc8 peer API 漂移 | host 编译失效 | S1 domain 层零 DSH API 依赖，风险不触达 |
| R6 | 并发旧/新二进制热重载混写同一数据目录 | 格式抖动 | 原子写保证文件始终完整；lazy 迁移下次写收敛；开发环境限制 |

## 7. 验收门汇总

- S0：S0-T1 完成＋阶段报告落盘。
- S1：W1–W9 全部完成；`npm test && npm run typecheck && npm run build && npm run verify:gate0 && npm run verify:sast && npm run verify:package && npm run verify:bundle` 全绿；§17.1 Phase 1 子集断言全部存在且通过；提交历史逐一关联 WBS 编号。
