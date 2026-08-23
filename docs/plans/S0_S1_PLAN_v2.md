# S0/S1 实施计划 v2

> 状态：v2（第一轮红队评审意见已回填，待第二轮可执行性复审）
> 相对 v1 变更：见附录 A（12 条意见，10 采纳 / 2 部分采纳 / 0 拒绝）

## 1. 目标与非目标

### 目标
- G1（S0）：独立复跑 Gate 0 全部可自动化验证，确认证据文档与脚本输出一致，产出 S0 阶段报告并正式关闭 Phase 0。
- G2（S1）：交付 V2 记录模型：`schemaVersion/recordVersion/workspaceKey/previewCurrent/previewPrevious`，含 V1→V2 lazy 迁移与确定性 legacy revision id。
- G3（S1）：交付预览两代旋转、restore 原子交换 primitive，以及「手动编辑不旋转 previous/preview」的存储层强制。
- G4（S1）：交付 strict outline builder（§8.4 校验与规范化）。
- G5（S1）：交付 settings 领域模块（类型、默认值、校验、仅新建合并策略）与稳定错误码模块（§16）；`MindmapConfig` 默认值收敛为 domain 单一事实源。
- G6（S1）：workspaceKey 规范化与哈希（Windows/macOS/Linux 样例覆盖，含 `\\?\` 前缀；platform 参数化保证任意主机可测）。

### 非目标（Non-goals）
- N1：不修改 `src/index.ts` 与 `src/client/**`。
- N2：不做 `ctx.settings.register()` Host 接线。
- N3：不实现 GenerationExecutor、锁、panel runs、chat Job（Phase 2）。
- N4：不改 REST 路由形状、错误码 HTTP 映射（Phase 3）。
- N5：不引入任何新 npm 依赖；不加测试框架。
- N6：不做迁移向导、批量迁移、settings schema 版本化、summaries 损坏自愈机制。
- N7：不动 Gate 0 live 项。

## 2. WBS 任务分解

复杂度：S ≤ 半天，M ≈ 1 天。每任务 TDD：先写失败测试 → 实现 → `npm run build` → 相关测试绿 → 全门禁 → 提交。**docs-only 任务同样复跑全门禁后才提交。**

| 编号 | 任务 | 输入文件 | 改动文件 | 验收标准（Given/When/Then） | 复杂度 |
|---|---|---|---|---|---|
| S0-T1 | Gate 0 独立复验与阶段收尾 | PHASE_0_GATE_0_EVIDENCE.md、scripts/gate0.mjs | 新增 docs/plans/S0_S1_STAGE_REPORT_S0.md | When 运行 `npm run verify:gate0`、`npm test`、`npm run typecheck`、`npm run build`；Then 全部退出码 0，G0 自动化项全 PASS，PENDING_LIVE 集合＝{G0-4-live,G0-5-live,G0-6-live} 且与证据文档一致，报告含复现命令与结果表 | S |
| S1-W1 | 错误码模块 | 设计 §16；src/library.ts 消息惯例 | 新增 src/domain/errors.ts、tests/domain.test.mjs；package.json test 链追加（偏差 D1） | Given DomainError(code,message)；When catch；Then `error.code`∈{CAPABILITY_UNAVAILABLE, SESSION_UNAVAILABLE, WORKSPACE_SCOPE_MISMATCH, MINDMAP_NOT_FOUND, MINDMAP_BUSY, MINDMAP_CONFLICT, MINDMAP_REVISION_EXPIRED, SOURCE_UNAVAILABLE, GENERATION_TIMEOUT, GENERATION_FAILED, INVALID_AGENT_OUTLINE, INVALID_REQUEST, STORAGE_FAILED}，message 可逐字兼容现行 `mindmap conflict`；`npm test` 含新文件 | S |
| S1-W2 | settings 领域模块＋配置单一事实源 | 设计 §7；src/library.ts DEFAULT_CONFIG | 新增 src/domain/settings.ts（含迁移后的默认配置常量）；src/library.ts 改为 import 该常量 + 测试 | Given 非法/边界 settings 输入；When normalizeMindmapSettings；Then 回退编译默认值且输出符合 §7 七字段接口；resolveNewRecordConfig(settings,requestConfig) 请求配置浅层优先；Given 已有 config；Then 不被 settings 覆盖；library.DEFAULT_CONFIG 与 domain 常量为同一对象引用（单一事实源断言） | M |
| S1-W3 | workspaceKey 规范化与哈希 | 设计 §6.2；评审 M5 | 扩展 src/domain/records.ts + 测试 | Given 样例集 {大小写混用盘符路径、正/反斜杠、`\\?\` 前缀、尾分隔符}×platform 参数('win32'/'posix')；When normalizeWorkspaceCwd(cwd,platform)+workspaceKeyOf；Then win32 组内同目录异写法同 key（sha256 前 32 hex）、posix 大小写敏感组内互异、跨 platform 样例互异；函数无 IO、无 realpath；相对路径输入抛 INVALID_REQUEST | M |
| S1-W4 | V2 记录类型与 lazy 迁移 | 设计 §6.1/§6.3（修订后） | 扩展 src/domain/records.ts + 测试 | Given V1 JSON；When migrateRecordToV2；Then 补 schemaVersion=2、recordVersion=1、workspaceKey='legacy-unscoped'、previewCurrent={revisionId:revisionIdOf(current),document:current,generatedAt:updatedAt}，且该迁移代计为第 1 代生成；重复 migrate 幂等（深比较相等）；Given V2 JSON；Then 字段原样保留；全程纯函数不触盘 | M |
| S1-W5 | 预览两代旋转与 restore primitive | 设计 §6.1、§17.1 | 扩展 src/domain/records.ts + 测试 | Given 第 3 次 Agent 生成；When rotateGenerationSnapshots(record,newDoc)；Then current→previous、previewCurrent→previewPrevious、previewCurrent=新快照(revisionId=revisionIdOf(newDoc))，第 1 代 revision 无法在任何字段寻址；Given applyManualEdit(record,newDoc)；Then 仅 current 更新，previous/preview 引用不变；Given swapCurrentPrevious(record)；Then 仅 current/previous 互换，两个 preview 快照引用不变 | M |
| S1-W6 | strict outline builder | 设计 §8.4；src/core.ts | 新增 src/domain/generation.ts + 测试 | 验收样例逐一机器可判：(a) title 空/'  '/121 字符→INVALID_AGENT_OUTLINE；(b) outline 空/>200000→同上；(c) `'# A'`（无子标题）→同上；(d) 合法 `'# R\n## C'`→文档过 validateMindmapDocument；(e) 跳级 `'# R\n### X\n## Y'`：先以 node 实测现行 parseMarkdownOutline 归属，将实测结果固化为断言（预期 X、Y 均挂靠 R 或按实测层级），断言不得丢任何节点标题；(f) maxNodes=3 输入 5 节点大纲→truncated=true 且节点数≤3；(g) transcript 纯文本→INVALID_AGENT_OUTLINE（不回退 parser） | M |
| S1-W7a | library 存储层 V2 写读贯通 | src/library.ts；W2/W4/W5 | 修改 src/library.ts + tests/library.test.mjs | Given 手工构造的 V1 fixture 文件（无新字段）置于 DSH_MINDMAP_HOME；When getMindmap/listMindmaps；Then 正常读取、返回含 V2 补全、list 不抛错；When 任意 save/update 落盘；Then 读回 JSON 键集 ⊇ {libraryId,title,current,previous?,config,source?,archived,createdAt,updatedAt,schemaVersion,recordVersion,workspaceKey,previewCurrent,previewPrevious?}，其中 V1 键值满足现行校验规则（current/previous 为合法文档、config 经 normalize 等价）；summaries 条目追加可选 workspaceKey；原子临时文件+rename 路径不变 | M |
| S1-W7b | CAS＋手动编辑语义修正＋restore 存储出口 | src/library.ts；评审 M2/M3 | 修改 src/library.ts + tests/library.test.mjs | (a) Given expectedRecordVersion 过期；When save/update/restore；Then 拒绝、消息含 `mindmap conflict`、磁盘 record 不变；成功写后 recordVersion=旧+1；(b) Given 同时提供 expectedRecordVersion 与 expectedUpdatedAt 且矛盾；Then 以 expectedRecordVersion 为准判定冲突（优先级规则）；(c) Given PATCH/update 带 document 未传 rotatePrevious；Then previous/preview 不变（默认不旋转；显式 rotatePrevious:true 仍生效）；(d) restorePreviousMindmap(id) 经写队列串行执行、成功后 recordVersion 递增、可往返；(e) 既有 expectedUpdatedAt 用例与 index.test.mjs 全绿（HTTP 行为回归硬门禁） | M |
| S1-W8 | SAST 清单补齐 | 评审 M4 | 修改 scripts/verify-sast.mjs | Given files 数组；Then 包含 src/domain/errors.ts、settings.ts、records.ts、generation.ts 及既有 4 文件，`npm run verify:sast` 绿 | S |
| S1-W9 | S1 阶段报告与一致性核对 | 全部产物 | 新增 docs/plans/S0_S1_STAGE_REPORT_S1.md；必要时微修 README/设计文档过期描述 | Then 报告含变更清单、七门禁结果表、遗留风险（R1/R3/R4/R7）、移交建议；并用 node 内联脚本量测同一 360 节点文档 V1 vs V2 序列化字节数写入报告（R4 基线） | S |

## 3. 测试策略（TDD）

- 循环：失败断言 → 最小实现 → `npm run build` → 目标测试绿 → 全门禁 → 提交。构建先行纪律（评审 m2/R2）。
- 单测：W1–W6 各验收样例；集成：W7a/W7b（含 V1 fixture、CAS 冲突、restore 往返、并发写队列回归）；回归网：tests/index.test.mjs 不改动但必须持续绿。
- 门禁：每任务 `npm test && npm run typecheck && npm run build`；阶段末加 verify:gate0/sast/package/bundle。

## 4. DevOps 集成点

### 提交切分
`docs(plan)` ×3 → `docs(phase0)`（S0-T1）→ `feat(domain)`（W1–W6，各一提交，正文 Refs: S1-Wx）→ `feat(library)`（W7a、W7b）→ `chore(sast)`（W8）→ `docs(phase1)`（W9）。

### CI 门禁映射
本地序列与 `.github/workflows/ci.yml` 一致；push 由 CI 复证。

### 证据留存
阶段报告内嵌可复现命令块＋结果表＋证据边界；不声称未执行的验证（对齐 PHASE_0_GATE_0_EVIDENCE.md 惯例）。

### 回滚方案
- 任务级：单提交可 `git revert`。
- 存储级（R1）：V2 写入后回滚旧二进制可读；旧二进制再写丢弃 V2 字段——发布冻结期内禁止混跑；lazy 迁移无需数据脚本。

## 5. 偏差与裁决预案

| 编号 | 偏差 | 备选对比 | 结论 | 若被否决的 fallback |
|---|---|---|---|---|
| D1 | package.json test 链追加 tests/domain.test.mjs | (a) 追加链（清晰零依赖）vs (b) 断言并入既有三文件（不动 package.json 但混杂） | 采纳 (a)：§21 的多 Agent 冲突动机在单 Agent trunk 下不存在，且不新增依赖 | 改为 (b)，将 domain 断言并入 tests/library.test.mjs 尾部并在 W1 验收注明 |
| D2 | S1 不接线 ctx.settings.register | (a) 本阶段接线（违反 §21/Phase 1 禁区）vs (b) 纯模块＋非目标 | 采纳 (b) | 无需 fallback（接线本就是集成阶段职责） |

## 6. 风险登记册

| 编号 | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 回滚后旧二进制写坏 V2 字段 | preview 丢失 | 结构兼容断言；发布冻结；阶段报告声明回滚窗口 |
| R2 | 陈旧 lib 假绿 | 缺陷漏检 | 先 build 后 test 纪律；CI 顺序正确 |
| R3 | Windows 路径边界哈希分歧 | 隔离失真 | W3 规范化＋platform 参数化样例 |
| R4 | API 响应含 V2 字段体积膨胀 | 面板变慢 | W9 量测基线；Phase 3 DTO 收敛 |
| R5 | rc8 peer API 漂移 | host 编译失效 | domain 层零 DSH API 依赖 |
| R6 | 新旧二进制混写数据目录 | 格式抖动 | 原子写完整；lazy 收敛；开发期限制 |
| R7 | summaries.json 损坏导致 list 整体报错 | 列表不可用 | 现行为（显式报错不静默清空）以测试锁定；自愈留后续阶段 |

---

# 附录 A：v1 红队评审意见与处理结论（Round 1，共 12 条）

| # | 问题 | 影响 | 建议动作 | 优先级 | 处理结论 |
|---|---|---|---|---|---|
| 1 | W7a「旧二进制可读的结构断言」不可机器判（无法在测试中运行旧版代码） | 验收标准不可执行 | 改为键集超集断言＋V1 键值逐项过现行校验规则 | High | 采纳：v2 W7a 验收重写为键集⊇固定集合＋值校验等价 |
| 2 | 默认语义翻转（M2）缺 HTTP 层回归保护清单 | 可能静默改变 PATCH 行为 | 将 index.test.mjs 全绿升级为 W7b 硬性验收项 | High | 采纳：v2 W7b(e) |
| 3 | 迁移记录的 previewCurrent 代次归属未定义 | 「第三次生成后首代失效」断言不确定 | 明确迁移代＝第 1 代 | Medium | 采纳：v2 W4 |
| 4 | expectedRecordVersion 与 expectedUpdatedAt 双轨优先级未定义 | 同请求矛盾参数行为不定 | 定义 CAS 优先级规则并进验收 | High | 采纳：v2 W7b(b) |
| 5 | summaries 损坏时 list 整体抛错，V2 放大影响面 | 列表可用性 | 登记风险＋锁定现行为测试 | Low | 部分采纳：新增 R7 与行为锁定；自愈机制维持非目标（避免 scope creep） |
| 6 | 平台样例在 ubuntu CI 上不可全验 | W3 验收不可判定 | normalizeWorkspaceCwd 增加 platform 参数（默认 process.platform） | High | 采纳：v2 W3/G6 |
| 7 | 偏差 D1/D2 缺被否决时的 fallback | 实施期可能卡死 | 为每条偏差预置 fallback | Medium | 采纳：v2 §5 |
| 8 | docs-only 任务是否过门禁未明示 | 流程歧义 | docs-only 提交同样复跑全门禁 | Low | 采纳：v2 §2 引言 |
| 9 | W6 跳级规范化「不丢根结构」不可机器判 | W6 无法开工 | 以实测 parser 行为固化样例断言，样例写死 | High | 采纳：v2 W6(e)（实施时先实测再定断言，禁止凭记忆假设） |
| 10 | R4 无量测方法 | 风险不可量化 | W9 用脚本量测 V1/V2 序列化字节基线 | Low | 部分采纳：量测纳入 W9 验收；不做持续性能基准设施 |
| 11 | settings 默认值与 library.DEFAULT_CONFIG 双源漂移 | 配置不一致 | 默认常量迁入 domain/settings.ts，library 反向引用 | High | 采纳：v2 W2/G5（W7a 依赖 W2 的引用关系） |
| 12 | restore 是否受写队列串行与版本递增约束未说明 | 并发窗口缺陷 | 明确 restore 走 enqueueWrite 且递增 recordVersion | Medium | 采纳：v2 W7b(d) |
