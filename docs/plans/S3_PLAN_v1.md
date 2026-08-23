# S3（Phase 3 · Tools、Routes、Chat Card）实施计划 v1

- 依据：`docs/TECHNICAL_DESIGN_AND_IMPLEMENTATION_PLAN.md` §10/§11/§12/§16/§17/§18/§20 Phase 3；`docs/plans/S2_DESIGN_DELTA_REVIEW.md`、`docs/plans/S2_DEVIATIONS.md`、`docs/plans/S2_STAGE_REPORT.md` 移交清单
- 基线：S2 收口提交 `4b00666`；工区仅一个未跟踪的编排残留文档 `SUBAGENT_DIVISION_OPTIMIZED.md`（非实现，登记 DEVIATIONS 后保持不动）
- 协议：本文件为 v1；经 [CRITIC-R1]（≥8 条）→ v2、[CRITIC-R2]（恰 3 条）→ v3 定稿后，**v3 是唯一实施依据**

## 1. 目标与非目标

### 目标
1. `generate_chat_mindmap` 改造为异步 launcher：立即返回 `{kind:'background', jobId, libraryId}`，owned Job 完成通知由官方 tool-jobs 投递（§10.1/§10.3）。
2. `present_chat_mindmap` 规范化为无推理、无写副作用的展示工具，引用持久化进 result content（replay-safe，§10.2）。
3. REST V2：路由实现移入 `src/host/routes.ts`，按 §11 表逐条落地错误码/CAS/白名单/256KB 上限。
4. Chat 卡与自有预览 dialog 组件化：四状态、img-only、LRU Blob URL 生命周期、键盘可达（§12）。
5. 失效语义集成断言：第三代失效、删除失效、reload replay（G0-4 三场景对应自动化子集）。

### 非目标
- 不改脑图页视觉 UI 与信息架构（Phase 4）；不动第 2 节产品约束。
- 不做 live 浏览器证据（G0-4-live/G0-5-live/G0-6-live 维持 PENDING_LIVE，归 runbook）。
- 不切换 `src/index.ts` 装配到新模块（W0 裁决点 (b)，见 §3-W0 预案）；不修 F-1（随集成切换单一实现时统一处理）。
- 不引入新依赖、不引入测试框架。

## 2. 工区对账（输入盘点 → WBS 映射）

| 现状 | 归属 |
|---|---|
| `src/index.ts` 内联 legacy 双工具 + 全部路由（冻结） | W3 迁移蓝本；集成期删除旧副本 |
| `src/host/adapters.ts` createChatGenerationLauncher（jobs.start 仅传 libraryId/title 的抽象壳） | W1 重构其 job 体归属 |
| `src/host/generation-executor.ts` runOutlineGeneration/commitGenerationOutcome；reserveLibraryId 在 domain/records.ts | W1 直接复用 |
| `src/client/index.ts` 内联 MindmapToolCard/SvgPreviewDialog（卸载即 revoke，无 LRU，状态未形式化） | W4/W5 抽取升级 |
| `tests/index.test.mjs` 冻结（只断言 ok/status/prompt 全文，不断言 error 形状——已核实 L72-99） | 持续绿的 legacy 兼容证明 |
| **F-S3-1（新发现）**：`src/domain/records.ts:96` 注释含 UTF-8 替换符（`§9.1` mojibake），read 工具拒读该文件 | W0 附带修复并登记 |

## 3. WBS（每任务 TDD＋单提交；复杂度 S/M/L）

### S3-W0 设计增量评审落盘（M）
产出 `docs/plans/S3_DESIGN_DELTA_REVIEW.md`，至少裁决：
- **(a) client 组件测试设施缺失下的 ToolCard 测法**。预案：纯逻辑抽离优先（状态机、LRU、payload 解析全部纯函数，node assert 直测）；DOM 结构用 react-dom/server `renderToStaticMarkup` 断言（react/react-dom 已是 devDependencies，**零新增依赖**；useEffect 不跑，副作用类断言退化为源码契约扫描）；焦点管理/Esc 等 effect 行为归源码契约＋runbook。备选：仅源码正则断言（弱，弃）；引入组件测试库（违反硬约束，禁）。
- **(b) index.ts 装配边界归本阶段还是集成**。预案：归集成——§20 Phase 3 文件清单不含 index.ts；S2 移交清单第 1 条明确接线替换归集成 Agent；S3 交付可装配模块（tools/routes 导出工厂），index.ts 冻结保 legacy 兼容证明。风险：新工具在真实 DSH 会话不可见直至集成——接受，live 验证本就属 runbook。
- **(c) E2E 用 fake jobs runtime 的驱动方式**。预案：新建 tests/tools.test.mjs 内置 FakeJobsService（实现 start(spec)/JobHooks 契约，计数 settle），复用 host.test.mjs 的 fake SubagentRuntimeLike 模式；完成通知路径以「settle → onJobDone 快照 → read() 取 output」模拟官方链路，不 mock tool-jobs 插件本身。
验收：三裁决各有采纳结论＋理由＋备选对比；文件落盘。
提交：`docs(design): adjudicate S3 deltas (Refs: S3-W0)`

### S3-W1 host/tools.ts 异步 launcher（M）
改动文件：新增 `src/host/tools.ts`、`tests/tools.test.mjs`；`package.json` test 链插位。
内容：
1. `buildSourceOutlinePrompt(input)` 进 generation-executor.ts（prompt 单一副本原则 §4.1）：聊天入口永远是「来源材料→大纲」（fork 继承已结束回合，supplementalContext=context 承载当前回合增量，§8.1 注记），prompt 明确 maxNodes/density/language/instruction/来源边界（§8.3）。persona/schema/toolFilter 复用 OUTLINE_* 常量。
2. 工具 `generate_chat_mindmap`：execute 同步路径 = 解析入参（context/title/libraryId/source/config/instruction，按 §10.1 校验）→ `libraryId = input.libraryId ?? reserveLibraryId()` → 锁 tryAcquire（失败抛 DomainError('MINDMAP_BUSY')）→ `ctx.jobs.start({kind:'mindmap', label, owner: agent, run})` → 返回 `{kind:'background', jobId, libraryId}`；jobs.start 抛出时释放锁。Job 体：accepted→running→runOutlineGeneration→commitGenerationOutcome（existing map 取 recordVersion 为 CAS baseline，absent 则 R11 语义）→ done 以 JobOutcome 结算：
   - completed：output 逐字等于 §10.1 模板：`mindmap completed: libraryId=<id> revisionId=<id> title=<json-string> nodes=<n>.\nCall present_chat_mindmap with libraryId and revisionId.`
   - timed_out/cancelled/failed/conflict：status failed/killed，output 含稳定 error code（GENERATION_TIMEOUT / MINDMAP_BUSY / INVALID_AGENT_OUTLINE / GENERATION_FAILED / MINDMAP_CONFLICT…），message 取 code→静态安全文案表；**完整 diagnostic 只进 host 日志，不进 model-facing output**（断言不含 stack 标记、绝对路径分隔符、原始来源片段）。
3. 工具 description 只加最小协议说明（后台任务＋完成通知后调用 present，§10.3）。
机器可判验收：
- Given fake jobs+runtime，When execute→settle→read，Then output 逐字匹配模板且 record 可读；
- When 同 libraryId 二次 launch，Then 立即抛 MINDMAP_BUSY 且 jobs 计数不变；
- When runtime 返回非法 outline，Then output 含 `code=INVALID_AGENT_OUTLINE` 且 sha256(record.current) 前后不变；
- 断言 GENERATION_TIMEOUT_MS===180_000 贯穿 chat 路径（注入短值验证超时分类）；
- launcher execute() 在 fake 依赖下同步返回，20 次串行每次 <250ms（§18 自动化代理指标）。
提交：`feat(tools): async mindmap launcher over owned jobs (Refs: S3-W1)`

### S3-W2 host/tools.ts 展示工具 replay-safe 化（M）
改动文件：`src/host/tools.ts` 扩展、`tests/tools.test.mjs` 扩展。
内容：legacy presentResult/presentContent 升级为规范副本迁入 tools.ts（模式同 D-S2-2）：
1. 无模型推理、无写入副作用：依赖注入只含只读 library 函数；测试用记录型 fake 断言 save/update/archive/delete 发射计数全零。
2. workspace 一致性：注入 `workspaceKeyOfAgent(agent)` resolver；record.workspaceKey 与调用方 workspaceKey 均可解析且不等 → 按「图不可用」处理：state='expired' + 通用标题 'Mind map'（**零标题泄漏**，断言输出不含真实 title/nodeCount）。
3. replay-safe：render content[0] 保持 `dsh-chat-mindmap-preview:`+JSON 持久载荷（gate0 G0-4-fixture 已锁形状），content[1] 为一句话文本；测试构造 call=null 的序列化 ToolResultNode（gate0 同构 fixture），仅凭 content 取回 libraryId/revisionId/title/state 并喂给卡片渲染器成功出图。
4. state∈{available,expired}；revision 命中 current/previous 之一才 available。
5. output.render 一句话文本（成功/失效各一）。
验收：上列 1–5 全部断言化；输出形状经 PRESENT_SCHEMA 校验。
提交：`feat(tools): replay-safe presentation tool with workspace fence (Refs: S3-W2)`

### S3-W3 host/routes.ts REST V2（L）
改动文件：新增 `src/host/routes.ts`、`tests/routes.test.mjs`；test 链插位。
内容：
1. `registerMindmapRoutes(deps)` 工厂：deps={webServer.register, services…}，返回 unregister；index.ts 一行可装配（集成期启用）。
2. §11 路由表逐条实现并以**表驱动用例**覆盖（method×path×预期 status/shape 矩阵）：health、capabilities、maps 列表/创建/读取/PATCH/DELETE、restore-previous、regenerate、panel-runs/:runId（GET/DELETE）、revisions/:revisionId。
3. 错误统一 `{ok:false,error:{code,message}}`：InputError→400 INVALID_REQUEST；DomainError 映射表 MINDMAP_NOT_FOUND→404、MINDMAP_BUSY→409、MINDMAP_CONFLICT→409、SESSION_UNAVAILABLE→409、MINDMAP_REVISION_EXPIRED→410、CAPABILITY_UNAVAILABLE→503、WORKSPACE_SCOPE_MISMATCH→404、INVALID_REQUEST→400、STORAGE_FAILED→500、其余→500 'mindmap service failed'；断言任意错误路径响应体无 `String(error)` 裸串（error 恒为对象且 message 来自白名单文案或 DomainError.message）。
4. id 白名单：libraryId ≤100 字符且匹配保留前缀格式、revisionId `/^rev-[a-f0-9]{24}$/`（既有）、runId panel-run 格式；不过白名单→400 INVALID_REQUEST。
5. mutation（POST/PATCH/DELETE/restore/regenerate）必须解析 live Agent：agents.get(SessionId(sessionId)) 失败→409 SESSION_UNAVAILABLE；expectedRecordVersion 缺失或不匹配→409 MINDMAP_CONFLICT（经 saveMindmap/updateMindmap CAS 路径）；GET revision 超两代或已删→410 MINDMAP_REVISION_EXPIRED。
6. body ≤256KB、requestSecurityError（loopback/same-origin/custom header）、15s body timeout：规范副本迁入 routes.ts（index.ts 冻结副本等价性由 index.test.mjs 黄金断言锁定）。
7. `tests/index.test.mjs` 零改动持续绿。
验收：矩阵每格断言；上述 3–6 各有专断言；新测试进 test 链（domain/host 之后、index 恒末位，引 D1 先例）。
提交：`feat(routes): table-driven REST V2 with coded errors and CAS (Refs: S3-W3)`

### S3-W4 client/components/MindmapToolCard.tsx（L）
改动文件：新增 `src/client/components/MindmapToolCard.tsx`、`src/client/components/blob-url-lru.ts`、`src/client/card-state.ts`（纯逻辑）、`tests/card.test.mjs`；`src/client/index.ts` 改 import（行为等价重构）。
1. 四状态 loading/ready/expired/failed 由纯函数 `cardStateOf(reference,url,error)` 派生，node 直测全覆盖（含 expired 优先于 failed、reference 缺失→failed-with-note）。
2. SVG 只来自 Host 验证过的 document：组件仅经 `GET /maps/:id/revisions/:rid` 取快照再本地 Export（沿用 svgPreview 路径），禁止渲染模型字符串——源码契约断言组件文件无 innerHTML/iframe/dangerouslySetInnerHTML，renderToStaticMarkup 输出断言无 '<iframe' 且 img-only。
3. `BlobUrlLru`（容量 20，注入 createObjectURL/revokeObjectURL）：put 触发淘汰 revoke 计数、disposeAll 计数、同 key 重复 put 不泄漏、get 命中提升；**组件卸载不撤销仍在 LRU 的 URL**（unmount 只解绑回调，revoke 计数 0；dispose 时才清）。node 环境 URL.createObjectURL 可用（gate0 已证）。
4. 缩略图为带可访问名称的图片按钮（aria-label=`打开 <title> SVG 预览`）。
5. renderToStaticMarkup 断言：ready 态含 img 结构与按钮可访问名；expired 态渲染失效文案；failed 态 role=alert。
提交：`feat(client-card): four-state tool card with LRU blob lifecycle (Refs: S3-W4)`

### S3-W5 client/preview/* 自有预览 dialog（S）
改动文件：新增 `src/client/preview/dialog.tsx`；`MindmapToolCard.tsx` 改用。
1. Esc 关闭、关闭后焦点恢复、closeRef 初始聚焦、Tab 焦点环内收（focus trap 纯函数可 node 直测）；effect 行为附源码契约锚点（keydown Escape / restoreFocusRef）。
2. aria：role=dialog、aria-modal=true、aria-label；renderToStaticMarkup 断言之。
3. DOM 负断言：preview 模块源码与静态渲染输出中无「编辑」「跳转」「打开脑图」按钮字样、无 <a> 元素、除 onClose 外无第二个 onClick 处理器名。
4. 不导入 DSH 私有编译产物（仅公开 @deepseek-ai/* client 出口；verify-package/bundle 门禁佐证）。
提交：`feat(client-preview): accessible standalone SVG dialog (Refs: S3-W5)`

### S3-W6 失效与 replay 语义集成（M）
改动文件：`tests/integration.test.mjs`（新）；test 链插位于 card 之后、index 之前。
1. 第三代失效：同一 libraryId 经真实 saveMindmap 连续三代 rotate → 第一代 revisionId：GET revisions→410 MINDMAP_REVISION_EXPIRED；present 工具→state='expired'；cardStateOf(reference)→expired 渲染。
2. 删除失效：deleteMindmap 后同两路断言（410/expired）。
3. reload＋call head 裁剪 replay：重建全部进程内注册表（locks/registry/LRU 清空，dispose 计数=淘汰+存量）、PanelRunRegistry.getViewOrInterrupted→'生成已中断'；以 call=null 序列化结果（G0-4 fixture 同构）解析 payload → renderToStaticMarkup 渲染 ready 卡片成功——对应 G0-4 三场景（live/reload/call-head-trimmed）自动化子集。
4. §18 子集补链：chat job 完成⇒GET /maps/:id 立即可读；失败后旧 current sha256 不变；180s 常量恒等；插件级 disposeAll 后 locks/registry/LRU 计数归零。
提交：`test(integration): expiry, deletion and reload-replay semantics (Refs: S3-W6)`

### S3-W7 verify-sast 清单补齐＋阶段报告＋门禁矩阵（S）
1. verify-sast files += tools.ts/routes.ts/components/*.tsx/preview/*.tsx/card-state.ts/blob-url-lru.ts；实测任意前缀 revert（临时移出 tools.ts 与 card-state.ts 两例）脚本仍绿后还原。
2. F-S3-1 mojibake 修复（records.ts:96 注释 §9.1）一并落盘。
3. `docs/plans/S3_STAGE_REPORT.md`：变更清单（WBS×提交）、门禁矩阵结果、§18 子集断言位置表、偏差摘要、遗留风险、Phase 4/集成移交清单（index.ts 接线四处替换：launcher/present/routes/F-1，live runbook 三项沿用 S2 移交）。
提交：`chore(sast)+docs(stage)` 一个或两个提交（Refs: S3-W7）

## B. 测试与门禁策略

- **E2E（fake 驱动）**：FakeJobsService＋fake SubagentRuntimeLike（S2 helper 模式）跑「launch→job settle→completion snapshot→job_output(read)→present 工具→cardStateOf/renderToStaticMarkup」全链路；契约键绑定不变（kind/label/owner/run/done/output）。
- **回归网**：tests/index.test.mjs 冻结不动必须绿；新增 tools/routes/card/integration 四个测试文件插链 core→library→domain→host→tools→routes→card→integration→index（index 恒末位，DEVIATIONS 引 D1 先例登记）。
- **§18 自动化子集断言分布**：并发拒绝=W1；completed⇒record 可读=W1/W6；失败字节 sha256 不变=W1（沿 S2 模式）；180s 常量=W1 恒等式；dispose 归零=W6（locks/registry/LRU 三处计数）。
- **安全断言独立成组**：错误响应形状（routes）、来源内容零泄漏（launcher output + present workspace fence）、SVG img-only（card/preview 源码契约＋静态渲染）。
- **门禁节奏**：每任务 `npm test && npm run typecheck && npm run build`（显式 $LASTEXITCODE 校验，DEV-S2-5 教训）；阶段末追加 verify:gate0/sast/package/bundle 全量。

## C. 回滚与风险增量

- 新增模块为主：tools/routes/card/preview/integration 任意前缀 revert 安全（sast existsSync 过滤保证缺文件不红）；client/index.ts 的 import 切换是唯一触碰既有行为文件的点，回滚即恢复内联版本（git 单提交粒度）。
- **R11（继承）** 新建图 absent baseline 残余竞态：锁内互斥＋接受期限制，维持 S2 结论。
- **R12（继承）** maxTokens 传递通道悬置：常量化断言，live 归 runbook；chat prompt 组装不得向 start() 传非 RC8_START_KEYS 契约键。
- **R13（新增）** 路由迁移破坏 0.1.x legacy 兼容：缓解=旧路由黄金断言冻结（index.test.mjs）＋迁移期双实现并存（index.ts 冻结副本 vs routes.ts 规范副本），集成期一次性切换并对照全量黄金断言。
- **R14（新增）** renderToStaticMarkup 断言能力边界（useEffect 不执行）：缓解=副作用行为一律抽纯函数或降级为源码契约锚点，不冒充 DOM 已验证；live 归 G0-4/G0-5 runbook。
