# S3（Phase 3 · Tools、Routes、Chat Card）实施计划 v3【定稿·唯一实施依据】

- 版本链：v1（`5f886da`）→ [CRITIC-R1] 12 条全采纳 → v2（`e56133f`）→ [CRITIC-R2] 恰 3 条（R2-1 结算表定稿／R2-2 断言可观测性 API／R2-3 CAS 双通道）全部处理 → 本版
- 依据文档：TECHNICAL_DESIGN §10/§11/§12/§16/§17/§18/§20 Phase 3；S2 冻结项与移交清单；gate0.mjs 契约
- 硬约束：产品约束第 2 节零改动；不改脑图页视觉 UI；tool description 最小协议说明；主聊天不等待后台生成；无 busy polling/sleep/wait；磁盘不保存 SVG；无新依赖/测试框架

## 0. [CRITIC-R2] 三条意见与处理结论（摘要）

| # | 问题 | 处理结论 |
|---|---|---|
| R2-1 | W1 结算表含未决句式，cancel 路径 output 不在验收清单 | §W1 结算表四行终稿；kill 行 output=`mindmap cancelled: libraryId=<id>. No map was changed.` 并入逐字断言 |
| R2-2 | LRU 单例测试顺序耦合；PanelRunRegistry 缺只读观测 | blob-url-lru.ts 导出 createBlobUrlLru(cap) 纯工厂＋getBlobUrlLru() 单例两层；PanelRunRegistry/GenerationLockRegistry 增补只读 size()（非破坏） |
| R2-3 | DELETE/restore CAS 入参通道二义 | 定死双通道：body JSON 优先、?expectedRecordVersion= 回退（仅 DELETE）；矩阵每 mutation 断言 body 通道＋DELETE 额外断言 query 通道 |

## 1. 目标与非目标
1. launcher 异步化（{kind:'background',jobId,libraryId}＋官方完成通知）。
2. present 工具 replay-safe 规范化（恰 5 键持久载荷）。
3. REST V2 迁入 host/routes.ts（表驱动、错误码、CAS、白名单、256KB）。
4. Chat 卡组件化（四状态/img-only/LRU）＋自有可访问预览 dialog。
5. 失效语义集成断言（三代失效/删除失效/reload replay＝G0-4 三场景自动化子集）。

非目标：脑图页 UI（Phase 4）；live 浏览器证据（runbook）；切换 index.ts 装配与修 F-1（集成期）；新依赖/测试框架。

## 2. 工区对账
继承 v1/v2 表格：index.ts 冻结蓝本｜adapters.ts 抽象壳重构归 W1｜executor/commit 直接复用｜client 内联卡片抽取升级｜index.test.mjs 冻结持续绿｜F-S3-1 mojibake 归 W0。

## 3. WBS（TDD＋单提交）

### S3-W0 设计增量评审落盘（M）
交付 `docs/plans/S3_DESIGN_DELTA_REVIEW.md`：
- (a) ToolCard 测法＝纯逻辑直测＋renderToStaticMarkup 结构断言（react-dom/server 已在依赖树；useEffect 不跑→副作用行为一律纯函数化或源码契约锚点）＋焦点/Esc 归 runbook。前置核查 tsconfig jsx。
- (b) index.ts 装配边界＝归集成（§20 清单＋S2 移交第 1 条）；S3 只交工厂。风险接受：live 可见性延至集成。
- (c) E2E fake 驱动＝FakeJobsService（start/hooks/settle/read 计数）＋fake SubagentRuntimeLike；不 mock tool-jobs 插件本体。
另交付 `docs/plans/S3_DEVIATIONS.md` 骨架＋初始三条：①未跟踪编排残留处置；②F-S3-1 修复登记；③测试链插位引 D1 先例。
提交：`docs(design): adjudicate S3 deltas and open deviations log (Refs: S3-W0)`

### S3-W1 host/tools.ts 异步 launcher（M）
新增 src/host/tools.ts、tests/tools.test.mjs；package.json test 链插位。
1. generation-executor.ts 增 `buildSourceOutlinePrompt(input)`（来源材料→大纲；context 作 supplementalContext 承载当前回合增量；prompt 含 maxNodes/density/language/instruction/来源边界；OUTLINE_* 复用；不向 runtime.start 传 RC8_START_KEYS 之外键）。
2. execute 同步路径：六字段校验（context/title/libraryId/source/config/instruction，均按 §10.1 可选语义）→ libraryId=input.libraryId ?? reserveLibraryId() → tryAcquire（忙抛 MINDMAP_BUSY）→ jobs.start({kind:'mindmap', label:'脑图生成：<title||source.kind>', owner, outputLimitBytes:2048, run}) → 返回 {kind:'background',jobId,libraryId}；RESULT_SCHEMA={kind:['background'],jobId,libraryId}；render 单行 jobId+libraryId 提示。
3. Job 体结算表【R2-1 终稿】：

| outline 结果 | JobOutcome.status | detail | output（model-facing，逐字） |
|---|---|---|---|
| completed 且 commit 成功 | completed | — | mindmap completed: libraryId=<id> revisionId=<rid> title=<JSON.stringify(title)> nodes=<n>. + 换行 + Call present_chat_mindmap with libraryId and revisionId. |
| timed_out | failed | timed out | mindmap failed: code=GENERATION_TIMEOUT. Generation exceeded 180 seconds. |
| cancelled（kill→abort） | killed | cancelled | mindmap cancelled: libraryId=<id>. No map was changed. |
| failed/conflict/storage/provider 缺失/map 缺失 | failed | — | mindmap failed: code=<CODE>. <code→静态安全文案>，CODE∈{INVALID_AGENT_OUTLINE, MINDMAP_CONFLICT, STORAGE_FAILED, CAPABILITY_UNAVAILABLE, MINDMAP_NOT_FOUND, GENERATION_FAILED} |

   全路径 finally locks.release(libraryId)；完整 diagnostic 仅进注入 logger（缺省 no-op）；output 断言不含 stack 标记、反斜杠/盘符路径、原始来源片段。
4. run() 同步抛→done={status:'failed', output:'mindmap failed: code=GENERATION_FAILED. Generation failed.'}；jobs.start 同步抛→execute 内 release 后重抛 CAPABILITY_UNAVAILABLE。
5. description 最小协议说明（后台任务＋完成通知后调用 present）。
验收（机器可判）：模板逐字匹配（标题样本含 CJK＋空格＋英文双引号）；二次 launch 同 id→MINDMAP_BUSY 且 jobs.start 计数不变；非法 outline→code=INVALID_AGENT_OUTLINE 且 sha256(record.current) 前后不变；GENERATION_TIMEOUT_MS===180_000 恒等＋注入短值分类 timed_out；kill→status killed 且 output 逐字匹配第三行且锁释放；start-throw→锁释放且工具上抛 CAPABILITY_UNAVAILABLE；fake 下 20 次串行 launch 每次 <250ms。
提交：`feat(tools): async mindmap launcher over owned jobs (Refs: S3-W1)`

### S3-W2 present 工具 replay-safe 化（M）
tools.ts 扩展＋tests 扩展：
1. 只读依赖注入；记录型 fake 断言 save/update/archive/delete 发射计数全零。
2. workspace fence：注入 workspaceKeyOfAgent resolver；双方均可解析且不等→state='expired'+title='Mind map'（断言输出不含真实 title/nodeCount）。
3. render content[0]=`dsh-chat-mindmap-preview:`＋JSON **恰 5 键**（libraryId/revisionId/title/nodeCount/state；与 gate0 G0-4-fixture strict deepEqual 同构）；content[1]=一句话文本；call=null fixture 仅凭 content 取回引用→cardStateOf 渲染成功。
4. 入参 ID 白名单与 routes 共用常量值（一致性断言：两模块导出字符串等值）；非法→DomainError('INVALID_REQUEST')。
5. state 判定：命中 current/previous 才 available；PRESENT_SCHEMA 去 capabilityNote。
提交：`feat(tools): replay-safe presentation tool with workspace fence (Refs: S3-W2)`

### S3-W3 host/routes.ts REST V2（L）
新增 src/host/routes.ts、tests/routes.test.mjs；链插位。
1. registerMindmapRoutes(deps)→unregister；deps={webServer.register, agents, panelAdapter, …}。
2. 表驱动矩阵覆盖：health(version=5)、capabilities({jobs,subagents,fork,settings,toolCard} 布尔，来源服务探测)、GET/POST /maps、GET/PATCH/DELETE /maps/:id、POST /maps/:id/restore-previous、POST /maps/:id/regenerate、GET/DELETE /panel-runs/:runId、GET /maps/:id/revisions/:rid。
3. 错误形状 {ok:false,error:{code,message}}；映射 INVALID_REQUEST→400／MINDMAP_NOT_FOUND→404／WORKSPACE_SCOPE_MISMATCH→404／MINDMAP_BUSY→409／MINDMAP_CONFLICT→409／SESSION_UNAVAILABLE→409／MINDMAP_REVISION_EXPIRED→410／CAPABILITY_UNAVAILABLE→503／STORAGE_FAILED→500／其余→500 'mindmap service failed'；error 恒为对象、无 String(error) 裸串。
4. CAS【R2-3】：PATCH/restore/regenerate 必带 body.expectedRecordVersion；DELETE 支持 body JSON 优先＋?expectedRecordVersion= 查询参数回退；作用于已存在 map 时缺失→400 INVALID_REQUEST；不匹配→409 MINDMAP_CONFLICT；POST /maps 免提交；regenerate 弃用 expectedUpdatedAt。
5. 白名单常量：LIBRARY_ID_PATTERN=/^map-[0-9a-z]+(-[0-9a-f]{12})?$/ 且 ≤100 字符；REVISION_ID_PATTERN=/^rev-[a-f0-9]{24}$/；RUN_ID_PATTERN=/^panel-[0-9a-z-]{8,80}$/；不过→INVALID_REQUEST。
6. mutation 必须 agents.get(SessionId(sessionId)) 存活否则 409 SESSION_UNAVAILABLE；body≤256KB；15s body timeout；requestSecurityError 规范副本迁入。
7. index.test.mjs 零改动持续绿。
提交：`feat(routes): table-driven REST V2 with coded errors and CAS (Refs: S3-W3)`

### S3-W4 MindmapToolCard 组件化（L）
新增 src/client/components/MindmapToolCard.tsx、src/client/components/blob-url-lru.ts、src/client/card-state.ts、tests/card.test.mjs；client/index.ts 改 import＋registerSnapshotFetcher 接线＋apply cleanup disposeAll；tsconfig 加 "jsx":"react-jsx"。
1. cardStateOf(reference,url,error) 纯函数：expired>failed>loading>ready 优先序；reference 缺失→failed+note。
2. SVG 仅来自注入 fetcher 取回的 Host 快照＋本地 Export；源码契约：组件文件无 innerHTML/dangerouslySetInnerHTML/<iframe 字样；renderToStaticMarkup 输出无 '<iframe'。
3. blob-url-lru.ts【R2-2】：createBlobUrlLru({capacity,create,revoke}) 纯工厂（put/get/has/size/disposeAll/stats{created,revoked,evicted}）；getBlobUrlLru() 单例惰性包装工厂（浏览器全局 create/revoke）。测试只用工厂实例（无顺序耦合）。断言：容量淘汰触发 revoke、get 提升、同 key 重 put 不泄漏不重复 revoke、unmount 场景 revoke 计数 0、disposeAll 后 size===0 且 revoked===created。
4. 缩略图图片按钮 aria-label=打开 <title> SVG 预览；ready/expired/failed 三态静态渲染结构断言。
提交：`feat(client-card): four-state tool card with module-scoped LRU (Refs: S3-W4)`

### S3-W5 自有预览 dialog（S）
新增 src/client/preview/dialog.tsx：Esc 关闭/焦点恢复/closeRef 初始聚焦/focus-trap 纯函数直测；aria role=dialog＋aria-modal=true＋aria-label 静态渲染断言；负断言（源码＋渲染输出）：无 编辑/跳转/打开脑图 按钮、无 <a> 元素、除 onClose 外无第二个 onClick 处理器名；仅导入公开 @deepseek-ai/* client 出口。
提交：`feat(client-preview): accessible standalone SVG dialog (Refs: S3-W5)`

### S3-W6 失效与 replay 语义集成（M）
新增 tests/integration.test.mjs（链插 card 后、index 前）：
1. 三代失效：真实 saveMindmap 连续三代 rotate→第一代 rid：GET revisions→410；present 工具→state expired；cardStateOf→expired 渲染文案。
2. 删除失效：deleteMindmap 后 GET revisions→410、present→expired。
3. reload＋call-head 裁剪：全新 locks/registry/LRU 实例（getViewOrInterrupted→'生成已中断'）；call=null fixture 解析 payload→renderToStaticMarkup ready 渲染成功（G0-4 live/reload/裁剪三场景自动化对应）。
4. dispose 归零【R2-2】：GenerationLockRegistry 补只读 size()、PanelRunRegistry 补只读 size()（非破坏扩展）；disposeAll 后 locks.size()===0、panelRuns.size()===0、lru.size===0 且 revoked===created。
提交：`test(integration): expiry, deletion and reload-replay semantics (Refs: S3-W6)`

### S3-W7 sast 清单＋阶段报告（S）
verify-sast files += 七个新文件；前缀 revert 实测（移出 tools.ts、card-state.ts 两例）仍绿后还原；F-S3-1 mojibake 修复落盘；docs/plans/S3_STAGE_REPORT.md（WBS×提交、门禁矩阵、§18 断言位置表、偏差摘要、遗留风险、Phase 4/集成移交清单：index.ts 四处接线替换＋F-1＋live runbook 三项）。
提交：chore(sast)+docs(stage)，一或两个提交。

## B. 测试与门禁策略
- E2E fake 全链路：launch→settle→snapshot→read(output)→present→cardStateOf/renderToStaticMarkup；契约键不变。
- 回归网：index.test.mjs 冻结持续绿；链 core→library→domain→host→tools→routes→card→integration→index（末位恒定）。
- §18 分布：并发拒绝=W1；completed⇒可读=W1+W3 GET；sha256=W1；180s 恒等=W1；dispose 归零=W6；<250ms 代理指标=W1。
- 安全断言组：routes 错误形状／tools 输出零泄漏（launcher＋present fence）／SVG img-only。
- 门禁节奏：每任务 npm test && typecheck && build（显式 $LASTEXITCODE 校验）；阶段末 verify:gate0/sast/package/bundle 全量。

## C. 回滚与风险
- 新增模块为主，任意前缀 revert 安全；client/index.ts import 切换是唯一既有行为触点，单提交回滚即恢复内联版本。
- R11 absent baseline 竞态（继承）；R12 maxTokens 通道悬置（继承，chat prompt 不传 RC8_START_KEYS 之外键）；R13 legacy 兼容（双实现并存＋黄金断言对照）；R14 renderToStaticMarkup 能力边界（effect 行为纯函数化或源码契约锚点，live 归 runbook）；R15 jsx 编译链变更随 W4 单提交验证 typecheck+build 双绿，回滚即 revert 该提交。
