# S4 计划 v1 — Brainmap UI 与 Settings UI

> 状态：v1（PLAN-AUTHOR 初稿，待 CRITIC-R1）。实施依据以 v3 为准。
> 基线：b25f18b（S3 收口：阶段报告在、工区净、test/typecheck/build 全绿）。
> 上游锚定：TECHNICAL_DESIGN §13/§13.3/§13.4/§14/§15/§17.3/§18/§20 Phase 4/§21/§22；S3 移交清单三项。

## 0. 工区现状对账（逐文件映射 WBS）

| 现状 | 与 §13 目标差距 | 归属 |
|---|---|---|
| `src/client/index.ts`（530 行单体）：全库列表无 session/workspace 过滤 | 违反约束「默认列表当前 session；“全部脑图”只显示当前 workspace」 | W2 |
| 内联样式＋裸 button/input/details；大量 `#hex`/`rgba` 字面量与 `var(--dsw-*,#hex)` 回退 | 违反 §13.3 官方 primitives/tokens | W3 |
| `MapCanvas` mount 即执行 `doExport.export('xmind')`（index.ts:323）；autosave 无请求序列防护 | 违反 §13.4 性能红线 | W4 |
| 无设置卡；host 未注册 settings namespace；`domain/settings.ts` 已备而未接 | 缺 S4-W5 全部交付 | W5 |
| 无 locale 层；UI 文案硬编码中文 | 缺 §14 双语 | W6 |
| `src/index.ts`（585 行 legacy）：内联 REST、legacy generate/present、本地 panel 重生成副本 | S3 移交第 1 条四处接线未做；F-1 未核销 | W1 |
| S3 新面已冻结可用：`createChatMindmapTools`/`registerMindmapRoutes`(ROUTES_VERSION=5)/`PanelRunRegistry`/`adapters` | 仅缺装配 | W1 |
| rc8 事实核查：@deepseek-ai 包内 **无公开导出**的 Button/Menu/Modal/Tooltip/Toast/StateDot/Input primitives；`ImageLightbox` 类型存在于未依赖包（禁导入不变）；官方 settings 面＝host `ctx.settings.register(ns, schemastery schema)` ＋ client `settings.plugins.tab` slot（经 settings mirror/scope）；官方 locale 服务提供 active locale 快照 | 决定 W3/W5/W6 技术路线 | W0 |

## 1. 目标与非目标

目标：Phase 4 全部交付（session-first IA、appearance/overflow 收纳、regenerate Modal、settings 卡、官方 tokens、双语、窄屏），并完成 S3 移交的 index.ts 集成切换与 F-1 核销。

非目标：A3 导出/题目页（Phase 4.5）；npm publish/tag/version（S5-W5 后人工）；macOS 实机 smoke（PENDING_LIVE runbook）；新测试框架或运行时依赖；改写产品约束第 2 节任何一行；不退回 setDraft 重建路径。

## 2. W0 设计增量评审（裁决项）

### (a) 集成收口任务边界与 diff 白名单

§21 把三个文件划给“最后集成 Agent”；本计划裁决：**集成切换的实施在 S4-W1/W5 执行，S5-W0 只做白名单审计**。白名单（越界改动即 S5-W0 判败）：

| 文件 | 允许的变更 |
|---|---|
| `src/index.ts` | 整体瘦身为装配：createChatMindmapTools/registerMindmapRoutes/PanelRunRegistry 接线；可选 inject jobs/subagents/settings；settings 包装器（仅新建记录合并 resolveNewRecordConfig）；删除 legacy 副本（parseGenerateInput 族、startPanelRegeneration 族、presentContent 五键旧形、内联 REST）；F-1 核销随切换 |
| `src/client/index.ts` | 只保留装配：slots 注入（brainmap view/toolview/plugins.tab）、registerSnapshotFetcher、LRU dispose、locale 服务读取；视图实现移入 components/* |
| `package.json` | scripts.test 插链（恒 index 末位）；devDependencies 增补类型面包（见 (d)）；peerDependencies 不动（归 S5-W1） |

### (b) S3 移交落位

① index.ts 四处接线→W1；② F-1（备注全超预算时无缺失提示）随切换在 canonical prompt 构建处修复并以表驱动用例锁定；③ live runbook 三项维持 PENDING_LIVE（本环境无真机会话）。另承接 D-S3-9：卡片主题表单一真相源收敛（W3 删除 index.ts 内联画布后自然达成）。

### (c) UI 断言手段（续 S3 裁决，不引入新依赖）

三层：①交互/状态逻辑抽纯函数（node assert 直测）；②结构断言用 react-dom/server renderToStaticMarkup（react 已是 devDep）；③副作用行为用源码契约锚点（SAST 式正则）声明，live 行为如实标注 PENDING_LIVE。禁止把静态结构断言声称为 DOM 行为验证。

### (d) 依赖论证通道

新增 **devDependencies only**（rc8 本机已在 node_modules，零网络安装）：`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-client-ui-settings`（类型＋fake 驱动所需契约）。理由：ctx.settings 与 settings.plugins.tab 的编译期契约；运行时全部可选探测、缺失即降级。peerDependencies 变更留 S5-W1。

### (e) “官方 primitives”缺位的替代路线

rc8 无公开 primitives 导出（对账表已证）。按 §15/ImageLightbox 同构先例：**自建最小可访问组件集**（Button/Input/Menu/Modal/Tooltip/Toast/StateDot），样式只用 `--dsw-*` token，不复制官方 CSS、不冒充官方件名。硬编码色值豁免面仅两处：SMMP 渲染数据模块（theme presets，属画布内容非 UI chrome）、导出产物模板（生成物非源码样式）。

## 3. WBS

每任务 TDD＋单提交；门禁 `npm test && npm run typecheck && npm run build`（npm_config_cache 重定向 .npm-cache/，D-S3-4）。

### S4-W1 host 集成切换（M/L）
- 改动：`src/index.ts`、`tests/index.test.mjs`（黄金断言按 canonical 语义重写，引 D-S3-8 先例）、`src/host/tools.ts`（仅当 F-1 修复点在此）。
- Given canonical tools/routes/panel-runs 已冻结，When apply() 以工厂接线并注入 fake jobs/subagents，Then：health/capabilities 报告 ROUTES_VERSION=5 能力面；POST /generate 不复存在；regenerate 走 PanelStartRequest(expectedRecordVersion)；present 输出五键 payload 由 previewPayloadText 产出且带 workspace fence；同 map 并发 MINDMAP_BUSY。
- Given 备注预算耗尽（F-1），When 构建 regeneration prompt，Then 输出包含显式缺失提示（omitted 说明），表驱动覆盖 0/部分/全部超预算三态。
- Given 卸载，When dispose，Then locks/panelRuns 归零（复用 integration 用例语义）。

### S4-W2 client 信息架构（M）
- 改动：新增 `src/client/api.ts`、`src/client/components/{BrainmapView,MapList}.tsx`；`src/client/index.ts` 收敛装配。
- 列表默认 `GET /maps?sessionId=…&scope=session`；“全部脑图”切 `scope=workspace`；空状态三分支（session 空/workspace 空/能力不可用 CAPABILITY_UNAVAILABLE 显式文案）；窄屏（<900px）列表折叠为下拉选择器；record 读取带 sessionId 且 404/410 分路呈现。
- Then：范围切换纯函数（listQueryOf）表驱动；空状态分支 renderToStaticMarkup 三断言；客户端不再调用已删除端点（源码锚点断言无 `/generate` POST）。

### S4-W3 自有 primitives ＋ tokens（M）
- 改动：新增 `src/client/components/ui/*.tsx`（Button/Input/Menu/Modal/Tooltip/Toast/StateDot）；业务组件全面替换内联样式；新增 `styles.css`（网格/尺寸/响应式/token 引用）。
- Then：色值扫描断言（`#[0-9a-f]{3,8}`/`rgba(`/`rgb(`/`hsl(` 在 client 源码零命中，豁免面除外——豁免文件白名单进断言本身）；Menu/Modal 具备 role/aria-* 结构断言（focus trap 纯函数直测，live 键盘 PENDING_LIVE）；无 `<style>` 复制官方 CSS（源码锚点）。

### S4-W4 性能红线（M）
- 改动：`components/MapCanvas.tsx`、`scripts/benchmark.mjs`（新）。
- 删除 eager XMind mount 导出（调用计数断言：export 仅由菜单触发路径调用）；`mountKeyOf(record)` 纯函数只含 libraryId+generatedAt，layout/theme 变更走 setLayout/setThemeConfig 不换 key（实例重建回归 R16 的机器防线＝纯函数＋effect 依赖数组源码锚点）；autosave 保持 700ms debounce 并新增 AbortController+单调序号防旧 PATCH 回写（shouldApplyResponse 纯函数表驱动）；360 节点基准脚本产出文档规范化/序列化耗时实测＋画布与 SVG 的 <1s 目标标注测量方法，浏览器侧实测记 PENDING_LIVE。

### S4-W5 Settings（M）
- 改动：`src/index.ts`（settings 注册＋saveRecord/save 包装）、新增 `src/client/components/MindmapSettingsCard.tsx`。
- Given ctx.settings 可用，When 注册 namespace `chat-mindmap`（schema 对齐 MindmapSettings，applies:'live'），Then capabilities.settings=true；新建记录（chat 或面板）config 合并 resolveNewRecordConfig；既有记录 PATCH 不经过合并路径（既有 config 优先断言）。
- Given ctx.settings 缺失，When mount，Then 编译默认值生效、capabilities.settings=false、client 不注册 plugins.tab（降级 fake 驱动）。
- Client 卡经 settings.plugins.tab slot 渲染，写路径走官方 mirror/scope；不可用时卡整体缺席而非报错。

### S4-W6 国际化与降级（M）
- 改动：新增 `src/client/locale.ts`（zh/en 字典＋t()）；各组件文案改经 t()。
- Then：字典双向零缺键脚本断言；未知 locale 回退英文；用户标题/节点/补充要求不进字典（架构性：字典值为静态文案，断言字典无动态拼接入口）；§15 六行降级表逐行 fake 驱动测试（subagents/jobs/settings/tool-slot/lightbox/fork-supplemental 各一例，复用 host fake 设施＋client 能力位纯函数）。

### S4-W7 verify-sast 清单＋阶段报告（S）
- verify:sast files += 全部新文件；容错复验（临时移走一个新文件跑门禁须 exit0 后还原）；报告含 §17.3 十条断言结果位置表、门禁矩阵、Phase 4.5 移交清单（mindmap-doc/export/quiz 入口点与已验证事实）。

## 4. B 节 测试与门禁策略
- 回归网冻结：tests/index.test.mjs 恒末位；新测试插链于 integration 之后 index 之前（D1/D-S3-3 先例）；新增 suites：client.test.mjs（IA/primitives/perf/locale/settings-client）、settings.test.mjs（host 注册与合并）。
- 门禁矩阵：每任务 test/typecheck/build；阶段末加 verify:gate0/sast/package/bundle 四件套。
- 性能数字凡不可本机判定者，一律标注方法与 PENDING_LIVE，禁止声称未执行的验证。
- 提交纪律：Conventional Commits；显式路径 add（D-S3-7）；每提交列修改文件/行为变化/测试命令/未验证边界。

## 5. C 节 回滚与风险增量（续接 R13）

| 风险 | 缓解 |
|---|---|
| R14 集成收口范围蔓延 | W0(a) diff 白名单；S5-W0 越界即败；W1 提交前 git diff 文件级核对 |
| R15 UI 测试设施真空 | 逻辑抽离优先＋renderToStaticMarkup＋锚点三层；引入依赖必须走 W0(d) 通道 |
| R16 MindMap instance 重建回归 | mountKeyOf 纯函数＋effect 依赖锚点＋外观应用单一代码路径 |
| R17 A3 大文档打印性能 | （S4.5 承接）预算估算＋真实渲染双证据 |
| R18 发布线混乱 | 版本冻结 0.1.4；0.2.0 发布动作一律人工确认；本阶段不触 publish/tag |

## 6. 提交切分

1. `docs(plan): S4 plan v1-v3 and design delta review`（W0，含 DEVIATIONS 开立）
2. `feat(host): assemble canonical tools, routes and panel runs; fix note-budget omission`（W1）
3. `feat(client): session-first brainmap information architecture`（W2）
4. `feat(client-ui): accessible primitives over dsw tokens`（W3）
5. `perf(client): lazy exports, fenced autosave, stable mount key`（W4）
6. `feat(settings): chat-mindmap namespace and plugin settings tab`（W5）
7. `feat(client-i18n): zh/en dictionaries and degradation matrix`（W6）
8. `chore(sast): expand manifest; docs: S4 stage report`（W7）

<!-- R1/R2 意见与采纳结论写入 v2/v3 -->
