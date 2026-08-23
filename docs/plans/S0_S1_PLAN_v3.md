# S0/S1 实施计划 v3（定稿 · 唯一实施依据）

> 状态：v3 FINAL。两轮红队评审完成（附录 A 12 条、附录 B 3 条），本文件取代 v1/v2 成为唯一实施依据。
> 依据：`docs/TECHNICAL_DESIGN_AND_IMPLEMENTATION_PLAN.md`（含 6b63014 §6.1 修订）、`docs/plans/S0_S1_DESIGN_REVIEW.md`
> 基线：commit `357037c`，全部门禁绿。
> 设计基线定位：trunk 按 `0.2.0-dev` 演进实施 Phase 0/1；`0.1.x` 发布线冻结，本计划不发布任何版本。

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
- N2：不做 `ctx.settings.register()` Host 接线（归集成阶段）。
- N3：不实现 GenerationExecutor、锁、panel runs、chat Job（Phase 2）。
- N4：不改 REST 路由形状、错误码 HTTP 映射（Phase 3）；library 层以 coded DomainError 表达。
- N5：不引入任何新 npm 依赖；不加测试框架（沿用裸 node assert）。
- N6：不做迁移向导、批量迁移、settings schema 版本化、summaries 损坏自愈机制。
- N7：不动 Gate 0 live 项（PENDING_LIVE 维持设计允许状态）。

## 2. WBS 任务分解

复杂度：S ≤ 半天，M ≈ 1 天。每任务 TDD：失败测试 → 最小实现 → `npm run build` → 目标测试绿 → 全门禁 → 提交。docs-only 任务同样复跑全门禁后才提交。

| 编号 | 任务 | 输入文件 | 改动文件 | 验收标准（Given/When/Then） | 复杂度 |
|---|---|---|---|---|---|
| S0-T1 | Gate 0 独立复验与阶段收尾 | PHASE_0_GATE_0_EVIDENCE.md、scripts/gate0.mjs | 新增 docs/plans/S0_S1_STAGE_REPORT_S0.md | When 运行 `npm run verify:gate0`、`npm test`、`npm run typecheck`、`npm run build`；Then 全部退出码 0，G0 自动化项全 PASS，PENDING_LIVE 集合＝{G0-4-live,G0-5-live,G0-6-live} 且与证据文档一致，报告含复现命令与结果表 | S |
| S1-W1 | 错误码模块 | 设计 §16；src/library.ts 消息惯例 | 新增 src/domain/errors.ts、tests/domain.test.mjs；package.json test 链追加（偏差 D1） | Given DomainError(code,message)；When catch；Then `error.code`∈13 个 §16 枚举值，message 可逐字兼容现行 `mindmap conflict`；`npm test` 含新文件 | S |
| S1-W2 | settings 领域模块＋配置单一事实源 | 设计 §7；src/library.ts DEFAULT_CONFIG | 新增 src/domain/settings.ts（含迁移后的默认配置常量）；src/library.ts 改为 import 该常量 + 测试 | Given 非法/边界 settings 输入；When normalizeMindmapSettings；Then 回退编译默认值且输出符合 §7 七字段接口；resolveNewRecordConfig(settings,requestConfig) 请求配置浅层优先；Given 已有 config；Then 不被 settings 覆盖；library.DEFAULT_CONFIG 与 domain 常量为同一对象引用（单一事实源断言） | M |
| S1-W3 | workspaceKey 规范化与哈希 | 设计 §6.2；评审 M5、附录 B-2 | 扩展 src/domain/records.ts + 测试 | Given 样例集 {大小写混用盘符路径、正/反斜杠、`\\?\` 前缀、尾分隔符}×platform('win32'/'posix')；When normalizeWorkspaceCwd(cwd,platform)+workspaceKeyOf；Then win32 组内同目录异写法同 key（sha256 前 32 hex）、posix 大小写敏感组内互异、跨 platform 样例互异；函数无 IO、无 realpath；相对路径输入抛 INVALID_REQUEST（计划补充规格，落地时登记进 docs/plans/S0_S1_DEVIATIONS.md） | M |
| S1-W4 | V2 记录类型与 lazy 迁移 | 设计 §6.1/§6.3（修订后） | 扩展 src/domain/records.ts + 测试 | Given V1 JSON（createdAt/updatedAt 为必填 string，与现行校验一致）；When migrateRecordToV2；Then 补 schemaVersion=2、recordVersion=1、workspaceKey='legacy-unscoped'、previewCurrent={revisionId:revisionIdOf(current),document:current,generatedAt:updatedAt}，迁移代计为第 1 代生成；重复 migrate 幂等（深比较相等）；Given V2 JSON；Then 字段原样保留；全程纯函数不触盘 | M |
| S1-W5 | 预览两代旋转与 restore primitive | 设计 §6.1、§17.1 | 扩展 src/domain/records.ts + 测试 | Given 第 3 次 Agent 生成；When rotateGenerationSnapshots(record,newDoc)；Then current→previous、previewCurrent→previewPrevious、previewCurrent=新快照(revisionId=revisionIdOf(newDoc))，第 1 代 revision 无法在任何字段寻址；Given applyManualEdit(record,newDoc)；Then 仅 current 更新，previous/preview 引用不变；Given swapCurrentPrevious(record)；Then 仅 current/previous 互换，两个 preview 快照引用不变 | M |
| S1-W6 | strict outline builder | 设计 §8.4；src/core.ts；附录 B-1 | 新增 src/domain/generation.ts + 测试 | 开工步骤零：先运行一次性 node 探针（命令：`node -e "import('./lib/core.js').then(m=>console.log(JSON.stringify(m.buildMindmap('# R\n### X\n## Y').root,null,1)))"`，需先 build）并将实测层级归属固化为测试断言常量，禁止凭记忆假设。验收样例逐一机器可判：(a) title 空/'  '/121 字符→INVALID_AGENT_OUTLINE；(b) outline 空/>200000→同上；(c) `'# A'` 无子标题→同上；(d) `'# R\n## C'`→过 validateMindmapDocument；(e) 探针样例：X、Y 全部保留且归属与探针实测一致；(f) maxNodes=3 输入 5 节点大纲→truncated=true 且节点数≤3；(g) transcript 纯文本→INVALID_AGENT_OUTLINE（不回退 transcript parser） | M |
| S1-W7a | library 存储层 V2 写读贯通 | src/library.ts；W2/W4/W5 | 修改 src/library.ts + tests/library.test.mjs | Given 手工构造的 V1 fixture 文件置于 DSH_MINDMAP_HOME；When getMindmap/listMindmaps；Then 正常读取、返回含 V2 补全、list 不抛错；When 任意 save/update 落盘；Then 读回 JSON 键集 ⊇ {libraryId,title,current,previous?,config,source?,archived,createdAt,updatedAt,schemaVersion,recordVersion,workspaceKey,previewCurrent,previewPrevious?}，其中每个 V1 键值满足现行校验规则等价断言；summaries 条目追加可选 workspaceKey；原子临时文件+rename 路径不变 | M |
| S1-W7b | CAS＋手动编辑语义修正＋restore 存储出口 | src/library.ts；评审 M2/M3 | 修改 src/library.ts + tests/library.test.mjs | (a) Given expectedRecordVersion 过期；When save/update/restore；Then 拒绝、消息含 `mindmap conflict`、磁盘 record 不变；成功写后 recordVersion=旧+1；(b) 同时提供 expectedRecordVersion 与 expectedUpdatedAt 且矛盾时以 expectedRecordVersion 判定；(c) Given update 带 document 未传 rotatePrevious；Then previous/preview 不变（默认不旋转；显式 rotatePrevious:true 仍生效）；(d) restorePreviousMindmap(id) 经写队列串行执行、成功后 recordVersion 递增、可往返；(e) 既有 expectedUpdatedAt 用例与 tests/index.test.mjs 全绿（HTTP 行为回归硬门禁） | M |
| S1-W8 | SAST 清单补齐 | 评审 M4；附录 B-3 | 修改 scripts/verify-sast.mjs | files 清单包含全部新增 src/domain/*.ts 与既有 4 文件；扫描入口对不存在文件 existsSync 容错跳过（保证任意前缀回滚后脚本仍可运行）；`npm run verify:sast` 绿 | S |
| S1-W9 | S1 阶段报告与一致性核对 | 全部产物 | 新增 docs/plans/S0_S1_STAGE_REPORT_S1.md；必要时微修 README/设计文档过期描述 | Then 报告含变更清单、七门禁结果表、遗留风险（R1/R3/R4/R7）、移交建议；node 内联脚本量测同一 360 节点文档 V1 vs V2 序列化字节数写入报告（R4 基线） | S |

## 3. 测试策略（TDD）

- 循环：失败断言 → 最小实现 → `npm run build` → 目标测试绿 → 全门禁 → 提交。构建先行纪律（R2）。
- 单测：W1–W6 验收样例；集成：W7a/W7b（V1 fixture、CAS 冲突、restore 往返、并发写队列回归）；回归网：tests/index.test.mjs 不改动但必须持续绿。
- 门禁：每任务 `npm test && npm run typecheck && npm run build`；阶段末加 verify:gate0/sast/package/bundle。

## 4. DevOps 集成点

### 提交切分
`docs(plan)` ×3 → `docs(phase0)`（S0-T1）→ `feat(domain)`（W1–W6 各一提交，正文 Refs: S1-Wx）→ `feat(library)`（W7a、W7b）→ `chore(sast)`（W8）→ `docs(phase1)`（W9）。

### CI 门禁映射
本地序列与 `.github/workflows/ci.yml` 一致；push 由 CI 复证。

### 证据留存
阶段报告内嵌可复现命令块＋结果表＋证据边界；不声称未执行的验证（对齐 PHASE_0_GATE_0_EVIDENCE.md 惯例）。实施期如触发偏差协议，统一追加至 docs/plans/S0_S1_DEVIATIONS.md。

### 回滚方案
- 任务级：单提交可 `git revert`；因 W8 采用存在性容错（附录 B-3），**任意前缀回滚后全部门禁仍可运行**。
- 存储级（R1）：V2 写入后回滚旧二进制可读；旧二进制再写丢弃 V2 字段——发布冻结期内禁止混跑；lazy 迁移无需数据脚本。

## 5. 偏差与裁决预案

| 编号 | 偏差 | 备选对比 | 结论 | 若被否决的 fallback |
|---|---|---|---|---|
| D1 | package.json test 链追加 tests/domain.test.mjs | (a) 追加链（清晰零依赖）vs (b) 断言并入既有三文件 | 采纳 (a)：§21 多 Agent 冲突动机在单 Agent trunk 下不存在，不新增依赖 | 断言并入 tests/library.test.mjs 尾部并注明 |
| D2 | S1 不接线 ctx.settings.register | (a) 本阶段接线（违反 §21/Phase 1 禁区）vs (b) 纯模块＋非目标 | 采纳 (b) | 无需 fallback |

## 6. 风险登记册

| 编号 | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 回滚后旧二进制写坏 V2 字段 | preview 丢失 | 结构兼容断言；发布冻结；阶段报告声明回滚窗口 |
| R2 | 陈旧 lib 假绿 | 缺陷漏检 | 先 build 后 test 纪律；CI 顺序正确 |
| R3 | Windows 路径边界哈希分歧 | 隔离失真 | W3 规范化＋platform 参数化样例 |
| R4 | API 响应含 V2 字段体积膨胀 | 面板变慢 | W9 量测基线；Phase 3 DTO 收敛 |
| R5 | rc8 peer API 漂移 | host 编译失效 | domain 层零 DSH API 依赖 |
| R6 | 新旧二进制混写数据目录 | 格式抖动 | 原子写完整；lazy 收敛；开发期限制 |
| R7 | summaries.json 损坏导致 list 整体报错 | 列表不可用 | 现行为以测试锁定；自愈留后续阶段 |

---

# 附录 A：Round 1 红队意见与处理结论（12 条：10 采纳 / 2 部分采纳）

| # | 问题→建议 | 优先级 | 结论 |
|---|---|---|---|
| 1 | 「旧二进制可读」不可机器判→键集超集＋值校验 | High | 采纳（W7a 重写） |
| 2 | 默认翻转缺 HTTP 回归保护→index.test.mjs 绿升硬门禁 | High | 采纳（W7b-e） |
| 3 | 迁移代次归属未定义→迁移代＝第 1 代 | Medium | 采纳（W4） |
| 4 | 双轨并发参数优先级未定义→CAS 优先 | High | 采纳（W7b-b） |
| 5 | summaries 损坏影响面→登记＋锁定行为 | Low | 部分采纳（R7；自愈维持非目标） |
| 6 | 平台样例 CI 不可全验→platform 参数化 | High | 采纳（W3/G6） |
| 7 | 偏差缺 fallback→预置 fallback | Medium | 采纳（§5） |
| 8 | docs-only 门禁歧义→同样复跑 | Low | 采纳（§2 引言） |
| 9 | 跳级规范化不可机器判→探针固化断言 | High | 采纳（W6 步骤零+e） |
| 10 | R4 无量测方法→纳入 W9 验收 | Low | 部分采纳（量测纳入；不做持续基准设施） |
| 11 | 配置默认值双源漂移→单一事实源迁 domain | High | 采纳（W2/G5） |
| 12 | restore 并发约束未说明→队列串行+版本递增 | Medium | 采纳（W7b-d） |

# 附录 B：Round 2 复审意见与处理结论（可执行性视角，恰 3 条）

| # | 视角 | 问题 | 影响 | 建议动作 | 处理结论 |
|---|---|---|---|---|---|
| B-1 | 任务粒度/开工 | W6(e) 要求「实测 parser 归属」但未定义探针步骤与断言来源，实施者可能凭记忆写断言 | 任务无法直接开工或断言失真 | 把探针命令写死为任务第零步，实测输出固化为断言常量 | 采纳：已写入 W6「开工步骤零」（含具体命令） |
| B-2 | 验收可判性/规格追溯 | W3「相对路径抛 INVALID_REQUEST」是计划对设计 §6.2 的新增规格，未走追溯通道 | 计划静默加规格，违反偏差纪律 | 落地时登记进 DEVIATIONS 文件，保持规格变更可审计 | 采纳：W3 验收注明登记动作；DEVIATIONS 机制写入 §4 证据留存 |
| B-3 | 回滚路径 | revert W1 后 verify-sast 清单引用不存在文件会使脚本崩溃，「任意任务可独立回滚」不成立 | 回滚组合性缺陷 | 扫描入口 existsSync 容错；回滚小节声明任意前缀安全 | 采纳：W8 验收与 §4 回滚方案已更新 |
