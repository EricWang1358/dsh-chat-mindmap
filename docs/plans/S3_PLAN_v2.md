# S3（Phase 3 · Tools、Routes、Chat Card）实施计划 v2

- 本版性质：[CRITIC-R1] 对 v1 的 12 条意见全部附采纳结论后的修订版；经 [CRITIC-R2]（恰 3 条）后定稿 v3
- 基线：v1 提交 `5f886da`；事实核验补充：gate0 G0-4-fixture 为**恰 5 键 strict deepEqual**（`libraryId/revisionId/title/nodeCount/state`）；`tsconfig.json` **无 jsx 配置**；`tests/index.test.mjs` 未触及 /health

## 0. [CRITIC-R1] 意见与采纳结论

| # | 优先级 | 问题 | 影响 | 建议 | 采纳结论 |
|---|---|---|---|---|---|
| R1-1 | P1 | CAS 契约不完整：哪些 mutation 必须带 `expectedRecordVersion`、缺失时行为、regenerate 现用 `expectedUpdatedAt` 的去留、restore 入参通道均未定 | 实现期即兴决策，验收不可判 | V2 统一 body.expectedRecordVersion；已有 map 缺失→400 INVALID_REQUEST，不匹配→409 MINDMAP_CONFLICT；POST /maps 免提交；regenerate 弃用 expectedUpdatedAt（routes.ts 为新面，无 legacy 黄金断言约束） | ✅ 采纳 → W3 契约表 |
| R1-2 | P1 | legacy presentContent 载荷含第 6 键 capabilityNote，与 gate0 G0-4-fixture 恰 5 键 deepEqual 冲突 | 「与 fixture 同构」断言永不成立；两套形状漂移 | canonical 载荷砍到恰 5 键；PRESENT 输出 schema 同步去掉 capabilityNote；降级文案改由卡片本地化承担 | ✅ 采纳 → W2 |
| R1-3 | P1 | LRU 归属（模块级 vs 实例级）与 reload 时 disposeAll 调用方未定义 | 实例级→卸载全撤销违反 §12.1；无人 dispose→reload 泄漏，§18 断言无落点 | 模块级单例 getBlobUrlLru()；client apply() effect cleanup 调 disposeAll()；§18 断言=disposeAll 后 size===0 且 revoke 计数===累计 create 计数 | ✅ 采纳 → W4/W6 |
| R1-4 | P1 | 卡片快照获取依赖 index.ts 私有 api()；新建 src/client/api.ts 则越权占用 Phase 4 文件名 | 抽取组件被迫侵入冻结文件或抢占 Phase 4 所有权 | 依赖注入：components 模块暴露 registerSnapshotFetcher()，apply() 用现有 api 接线；api.ts 仍归 Phase 4 | ✅ 采纳 → W4 |
| R1-5 | P2 | tsconfig 无 jsx 配置而设计文档点名 .tsx 新文件 | W4 直接建 .tsx 即 typecheck 红 | W4 提交内加 `"jsx":"react-jsx"`（react/jsx-runtime 已在 tsdown CLIENT_EXTERNALS）；W0 评审先核实 | ✅ 采纳 → W0/W4 |
| R1-6 | P2 | 正文多处「登记 DEVIATIONS」但无任务负责创建该文件 | 初始对账项（残留文档处置、F-S3-1、链插位）散落遗漏 | W0 交付物追加 docs/plans/S3_DEVIATIONS.md 骨架＋三条初始登记 | ✅ 采纳 → W0 |
| R1-7 | P2 | GET /capabilities 载荷契约缺失 | 表驱动矩阵无期望形状可断言 | 定义布尔键集 {jobs,subagents,fork,settings,toolCard} 来源=注入服务探测；/health 附 version | ✅ 采纳 → W3 |
| R1-8 | P2 | job 体 run() 同步抛出等异常路径的锁释放未规定；jobs.start 抛错路径已有但无断言 | 异常路径锁泄漏→同图永久 BUSY 直至重启，违反 §9.1 | run() 全包 try/catch/finally；同步抛→done={status:'failed',output:'mindmap failed: code=GENERATION_FAILED'}；补 start-throw 释放断言 | ✅ 采纳 → W1 |
| R1-9 | P2 | 「逐字匹配 §10.1 模板」未定 title 特殊字符序列化样本 | 平凡标题过测、真实标题（CJK/空格/引号）失败 | 验收样例含 CJK+空格+引号标题，断言 title= 后为 JSON.stringify(title) 原文 | ✅ 采纳 → W1 |
| R1-10 | P3 | sha256/180s 恒等式在 W1 与 W6 双写 | 双处维护漂移 | 恒等式留首现处；W6 仅保留跨模块接线新增断言 | ✅ 采纳 → W6 收敛 |
| R1-11 | P3 | JobStart.outputLimitBytes 未利用 | 异常超长输出冲击完成通知（防御深度） | launcher 设 outputLimitBytes=2048 并断言 | ✅ 采纳 → W1 |
| R1-12 | P3 | present 工具入参白名单未明确，与路由面校验强度可能不一致 | 工具面成为绕过白名单的旁路 | tools/routes 共享同一 ID_PATTERN 常量值＋一致性断言；非法→INVALID_REQUEST | ✅ 采纳 → W2/W3 |

---

## 1. 目标与非目标（继承 v1，无修订）

### 目标
1. `generate_chat_mindmap` 改造为异步 launcher：立即返回 `{kind:'background', jobId, libraryId}`，owned Job 完成通知由官方 tool-jobs 投递（§10.1/§10.3）。
2. `present_chat_mindmap` 规范化为无推理、无写副作用的展示工具，引用持久化进 result content（replay-safe，§10.2）。
3. REST V2：路由实现移入 `src/host/routes.ts`，按 §11 表逐条落地错误码/CAS/白名单/256KB 上限。
4. Chat 卡与自有预览 dialog 组件化：四状态、img-only、LRU Blob URL 生命周期、键盘可达（§12）。
5. 失效语义集成断言：第三代失效、删除失效、reload replay（G0-4 三场景对应自动化子集）。

### 非目标
- 不改脑图页视觉 UI 与信息架构（Phase 4）；不动第 2 节产品约束。
- 不做 live 浏览器证据（G0-4-live/G0-5-live/G0-6-live 维持 PENDING_LIVE，归 runbook）。
- 不切换 `src/index.ts` 装配到新模块；不修 F-1（随集成切换单一实现时统一处理）。
- 不引入新依赖、不引入测试框架。

## 2. 工区对账（继承 v1）

| 现状 | 归属 |
|---|---|
| `src/index.ts` 内联 legacy 双工具 + 全部路由（冻结） | W3 迁移蓝本；集成期删除旧副本 |
| `src/host/adapters.ts` createChatGenerationLauncher 抽象壳 | W1 重构其 job 体归属 |
| `src/host/generation-executor.ts` executor/commit；reserveLibraryId 在 domain/records.ts | W1 直接复用 |
| `src/client/index.ts` 内联 MindmapToolCard/SvgPreviewDialog（卸载即 revoke、无 LRU） | W4/W5 抽取升级 |
| `tests/index.test.mjs` 冻结（不断言 error 形状、不触 /health——已核实） | 持续绿的 legacy 兼容证明 |
| F-S3-1：records.ts:96 注释 mojibake | W0 修复并登记 |

## 3. WBS（每任务 TDD＋单提交）

### S3-W0 设计增量评审落盘（M）
产出 `docs/plans/S3_DESIGN_DELTA_REVIEW.md`，裁决三项：
- **(a) ToolCard 测法**：纯逻辑抽离优先（状态机/LRU/payload 解析纯函数直测）；DOM 结构用 react-dom/server renderToStaticMarkup（零新依赖；useEffect 不跑，副作用退化为源码契约锚点）；焦点/Esc 行为源码契约＋runbook。弃：仅正则断言（弱）、引入组件库（违规）。前置核查项：tsconfig jsx 配置现状（R1-5）。
- **(b) index.ts 装配边界**：归集成（§20 Phase 3 清单不含 index.ts；S2 移交第 1 条）。S3 交付可装配工厂，index.ts 冻结。风险接受：live 会话可见性延至集成/runbook。
- **(c) E2E fake 驱动**：FakeJobsService（start(spec)/JobHooks/settle/read 计数）＋host.test.mjs 的 fake runtime 模式；完成通知以 settle→snapshot→read 模拟，不 mock tool-jobs 插件。
另交付 `docs/plans/S3_DEVIATIONS.md` 骨架＋三条初始登记（R1-6）：①未跟踪编排残留文档处置；②F-S3-1 mojibake 修复；③测试链插位引 D1 先例。
验收：三裁决各有结论＋理由＋备选对比；两文件落盘。
提交：`docs(design): adjudicate S3 deltas and open deviations log (Refs: S3-W0)`

### S3-W1 host/tools.ts 异步 launcher（M）
改动文件：新增 `src/host/tools.ts`、`tests/tools.test.mjs`；package.json test 链插位。
内容：
1. `buildSourceOutlinePrompt(input)` 进 generation-executor.ts：聊天入口永远是「来源材料→大纲」（context 作 supplementalContext 承载当前回合增量），prompt 明确 maxNodes/density/language/instruction/来源边界；OUTLINE_* 常量复用。
2. 工具 execute 同步路径：解析入参（六字段按 §10.1 校验）→ `libraryId = input.libraryId ?? reserveLibraryId()` → 锁 tryAcquire（忙抛 MINDMAP_BUSY）→ `jobs.start({kind:'mindmap', label:'脑图生成：<title 或 source.kind>', owner, outputLimitBytes:2048(R1-11), run})` → 返回 {kind:'background', jobId, libraryId}。RESULT_SCHEMA={kind:['background'],jobId,libraryId}；render 单行文本含 jobId+libraryId。
3. Job 体（R1-8）：run() 返回 {cancel(reason){controller.abort(reason)}, done}；done 由全包 try/catch/finally 的异步体结算——accepted→running→runOutlineGeneration→commitGenerationOutcome（existing map 取 recordVersion 为 CAS baseline；absent=R11 语义）→ 结算表：
   - completed → {status:'completed', output:`mindmap completed: libraryId=${id} revisionId=${rid} title=${JSON.stringify(title)} nodes=${n}.\nCall present_chat_mindmap with libraryId and revisionId.`}（R1-9：测试样本标题含 CJK+空格+英文引号）
   - timed_out→failed+code=GENERATION_TIMEOUT；cancelled(kill)→killed+code=MINDMAP_CANCELLED? —— **否**：取消属 killed 且 output 用稳定 code=CANCELLED 不在错误码表，改为 detail='cancelled'、output='mindmap cancelled.'（非错误语义）
   - failed/conflict/storage → status='failed'，output=`mindmap failed: code=<CODE>. <静态安全文案>`（code∈DOMAIN_ERROR_CODES 映射：INVALID_AGENT_OUTLINE/MINDMAP_CONFLICT/STORAGE_FAILED/CAPABILITY_UNAVAILABLE/GENERATION_FAILED）
   - 完整 diagnostic 只进注入的 logger（缺省 no-op），model-facing output 断言无 stack/绝对路径分隔符/原始来源片段。
   - 任何路径 finally：locks.release(libraryId)。
4. jobs.start 同步抛错：execute catch 内 release 后重抛（补断言 R1-8）。
5. description 最小协议说明（§10.3）。
验收（机器可判）：模板逐字匹配（含特殊标题）；二次 launch 同 id→MINDMAP_BUSY 且 jobs 计数不变；非法 outline→code=INVALID_AGENT_OUTLINE 且 sha256(record.current) 不变；GENERATION_TIMEOUT_MS===180_000 恒等＋注入短值分类正确；fake 下 execute 20 次串行每次 <250ms；kill→killed 且锁释放；start-throw→锁释放且工具报 CAPABILITY_UNAVAILABLE。
提交：`feat(tools): async mindmap launcher over owned jobs (Refs: S3-W1)`

### S3-W2 present 工具 replay-safe 化（M）
改动文件：tools.ts 扩展、tests/tools.test.mjs 扩展。
1. 无推理无写入：依赖仅注入只读函数；记录型 fake 断言 save/update/archive/delete 发射计数全零。
2. workspace fence：注入 workspaceKeyOfAgent resolver；双方均可解析且不等 → state='expired'+title='Mind map'（断言输出不含真实 title/nodeCount）。
3. replay-safe（R1-2）：render content[0]=`dsh-chat-mindmap-preview:`+JSON **恰 5 键**（libraryId/revisionId/title/nodeCount/state，与 gate0 fixture strict deepEqual）；content[1]=一句话文本；call=null fixture 仅凭 content 取回引用并渲染成功。
4. 入参白名单（R1-12）：ID_PATTERN 与 routes 同值常量；非法→DomainError('INVALID_REQUEST')。
5. state 判定：命中 current/previous 才 available；schema 去 capabilityNote。
提交：`feat(tools): replay-safe presentation tool with workspace fence (Refs: S3-W2)`

### S3-W3 host/routes.ts REST V2（L）
改动文件：新增 src/host/routes.ts、tests/routes.test.mjs；test 链插位。
1. registerMindmapRoutes(deps) 工厂返回 unregister；index.ts 一行可装配（集成期启用）。
2. §11 表驱动矩阵：health、capabilities、maps CRUD、restore-previous、regenerate、panel-runs/:runId GET/DELETE、revisions/:revisionId。
3. capabilities 载荷（R1-7）：{ok:true,value:{jobs,subagents,fork,settings,toolCard:boolean}}，来源=deps 服务探测；health 附 version（V2 起 5）。
4. CAS 契约（R1-1）：

| mutation | 必须提交 expectedRecordVersion | 缺失（作用于已存在 map） | 不匹配 |
|---|---|---|---|
| PATCH /maps/:id | 是（body） | 400 INVALID_REQUEST | 409 MINDMAP_CONFLICT |
| DELETE /maps/:id | 是（body） | 同上 | 同上 |
| POST /maps/:id/restore-previous | 是（body） | 同上 | 同上 |
| POST /maps/:id/regenerate | 是（body；弃用 expectedUpdatedAt） | 同上 | 同上 |
| POST /maps（新建） | 否 | — | — |

5. 错误统一 {ok:false,error:{code,message}}：映射表 INVALID_REQUEST→400 / MINDMAP_NOT_FOUND→404 / WORKSPACE_SCOPE_MISMATCH→404 / MINDMAP_BUSY→409 / MINDMAP_CONFLICT→409 / SESSION_UNAVAILABLE→409 / MINDMAP_REVISION_EXPIRED→410 / CAPABILITY_UNAVAILABLE→503 / STORAGE_FAILED→500 / 其余→500 'mindmap service failed'；断言 error 恒为对象、无 String(error) 裸串。
6. 白名单（R1-12 同值常量）：libraryId ≤100 且 /^map-[0-9a-z]+(-[0-9a-f]{12})?$/；revisionId /^rev-[a-f0-9]{24}$/；runId /^panel-[0-9a-z-]{8,80}$/；session/run id 参数同样受限。
7. mutation 必须 agents.get(SessionId(sessionId)) 存活→否则 409 SESSION_UNAVAILABLE；256KB body 上限＋15s timeout＋requestSecurityError 规范副本迁入。
8. tests/index.test.mjs 零改动持续绿。
提交：`feat(routes): table-driven REST V2 with coded errors and CAS (Refs: S3-W3)`

### S3-W4 MindmapToolCard 组件化（L）
改动文件：新增 src/client/components/MindmapToolCard.tsx、blob-url-lru.ts、src/client/card-state.ts、tests/card.test.mjs；client/index.ts 改 import＋接线；tsconfig 加 "jsx":"react-jsx"（R1-5）。
1. cardStateOf(reference,url,error) 纯函数派生 loading/ready/expired/failed（expired 优先于 failed；reference 缺失→failed+note）。
2. SVG 仅来自 Host 快照：经注入的 registerSnapshotFetcher(fn)（R1-4，apply() 用现有 api 接线）取 revisions 快照再本地 Export；源码契约断言组件文件无 innerHTML/iframe/dangerouslySetInnerHTML；renderToStaticMarkup 输出无 '<iframe'。
3. BlobUrlLru（容量 20，注入 create/revoke）：**模块级单例 getBlobUrlLru()**（R1-3）；put 淘汰 revoke 计数、get 提升、同 key 重复 put 不泄漏；组件 unmount 不撤销仍在 LRU 的 URL（revoke 计数 0）；client apply() effect cleanup 调 disposeAll()。
4. 缩略图＝带可访问名称图片按钮（aria-label=打开 <title> SVG 预览）。
5. renderToStaticMarkup 断言 ready/expired/failed 三态结构与可访问名。
提交：`feat(client-card): four-state tool card with module-scoped LRU (Refs: S3-W4)`

### S3-W5 自有预览 dialog（S）
改动文件：新增 src/client/preview/dialog.tsx；MindmapToolCard 改用。
Esc 关闭/焦点恢复/closeRef 初始聚焦/focus-trap 纯函数直测；aria role=dialog+aria-modal+aria-label 静态断言；负断言：preview 模块源码与渲染输出无 编辑/跳转/打开脑图 按钮、无 <a>、除 onClose 外无第二个 onClick 处理器名；仅导入公开 @deepseek-ai/* client 出口。
提交：`feat(client-preview): accessible standalone SVG dialog (Refs: S3-W5)`

### S3-W6 失效与 replay 语义集成（M）
改动文件：新增 tests/integration.test.mjs；链插位 card 之后、index 之前。
1. 第三代失效：真实 saveMindmap 连续三代 rotate→第一代 rid：GET revisions→410；present→expired；cardStateOf→expired 渲染。
2. 删除失效：deleteMindmap 后同两路断言。
3. reload＋call-head 裁剪 replay：重建 locks/panel-runs/LRU（getViewOrInterrupted→生成已中断）；call=null fixture 解析 payload→renderToStaticMarkup 渲染 ready 成功——G0-4 三场景自动化子集。
4. dispose 归零：disposeAll 后 locks.size===0、registry 空、LRU size===0 且 revoke 计数===累计 create 计数（R1-3 落点）。
（恒等式类断言留 W1 首现处，此处不重复——R1-10。）
提交：`test(integration): expiry, deletion and reload-replay semantics (Refs: S3-W6)`

### S3-W7 sast 清单＋阶段报告（S）
verify-sast files += 新增七文件；前缀 revert 实测（移出 tools.ts、card-state.ts 两例）仍绿后还原；F-S3-1 修复落盘；docs/plans/S3_STAGE_REPORT.md（WBS×提交、门禁矩阵、§18 断言位置表、偏差摘要、遗留风险、Phase 4/集成移交清单：index.ts 四处接线替换＋F-1＋live runbook 三项）。
提交：`chore(sast): extend scan list, fix records encoding; docs(stage): S3 report (Refs: S3-W7)`

## B. 测试与门禁策略（继承 v1＋收敛）
- E2E fake 驱动全链路：launch→settle→snapshot→read(output)→present→cardStateOf/renderToStaticMarkup；契约键不变。
- 回归网：index.test.mjs 冻结持续绿；链序 core→library→domain→host→tools→routes→card→integration→index。
- §18 子集分布：并发拒绝=W1；completed⇒可读=W1/W3(GET)；sha256=W1；180s=W1；dispose 归零=W6；launcher <250ms 代理指标=W1。
- 安全断言组：routes 错误形状；tools 输出零泄漏（launcher+present fence）；SVG img-only。
- 门禁节奏：每任务 test+typecheck+build（显式 $LASTEXITCODE）；阶段末 gate0/sast/package/bundle 全量。

## C. 回滚与风险增量（继承 v1，R14 扩展措辞）
- 新增模块为主，任意前缀 revert 安全；client/index.ts import 切换是唯一既有行为触点，单提交回滚即恢复。
- R11 absent baseline 竞态（继承）；R12 maxTokens 通道（继承，chat prompt 不传非 RC8_START_KEYS 键）；R13 legacy 兼容（双实现并存＋黄金断言对照）；
- **R14** renderToStaticMarkup 能力边界：effect 类行为一律纯函数化或源码契约锚点，绝不声称 DOM 已验证；live 归 G0-4/G0-5 runbook。
- **R15（R1-5 引出）** jsx 编译链变更（tsconfig+tsdown）：W4 内一次性验证 typecheck+build 双绿后才继续；回滚=revert 该提交恢复 .ts-only 世界。
