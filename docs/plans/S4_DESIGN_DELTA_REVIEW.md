# S4 设计增量评审与前置裁决记录

- 性质：Phase 4 开工前裁决，对应 v3 计划 W0；输入＝TECHNICAL_DESIGN §13–§15/§17.3/§20 Phase 4/§21、S3 移交清单、工区对账（S4_PLAN_v1 §0）、rc8 node_modules 实测。
- 结论：裁决项 (a)–(g) 全部落定，两项开工前置核查通过，**无剩余阻塞项，S4 可进入实施**。第 2 节产品约束零改动。

## (a) 集成收口边界与 diff 白名单

裁决：集成切换实施于 S4（W1/W5），S5-W0 仅审计。白名单三文件及允许变更见 S4_PLAN_v3 §W0(a)（index.ts 装配化；client/index.ts 收敛装配；package.json 仅 test 插链＋devDeps 类型面）。越界改动由 S5-W0 判败（R14）。

## (b) S3 移交落位

① index.ts 四处接线→W1 单提交；② F-1 定位于 `src/host/generation-executor.ts::buildRegenerationPrompt:26-28`（实测确认：nodeNoteReference.notes 为空且 omitted>0 时输出零缺失提示），修复随 W1 以表驱动用例锁 0/部分/全部超预算三态；③ live runbook 三项维持 PENDING_LIVE。D-S3-9 主题表单一真相源在 W3 删除内联画布路径后自然收敛。

## (c) UI 断言手段

沿用 S3 三层裁决并加码：逻辑纯函数直测／renderToStaticMarkup 结构断言／源码契约锚点；新增 api fetch seam 与 FakeApi 序列驱动视图状态机（R1-7）。禁止把静态结构断言声称为 DOM 行为验证；live 项一律标注 PENDING_LIVE。

## (d) 依赖论证通道（裁决通过）

新增 devDependencies：`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-client-ui-settings`（本机 rc8 node_modules 已存在，零网络安装）。用途：ctx.settings.register 与 settings.plugins.tab 的编译契约＋fake 驱动测试。运行时全部可选探测、缺失即降级（§15 第 4 行）。peerDependencies 不动，归 S5-W1。

## (e) 官方 primitives 缺位的替代路线

实测：全部已安装 @deepseek-ai 包的 .d.ts 无公开导出 Button/Menu/Modal/Tooltip/Toast/StateDot/Input（仅 settings-plugins 内部 card-form textField 等特化件）；`ImageLightbox` 类型存在于未依赖包 dsh-client-ui-attachment——按 §2 约束继续排除。裁决：自建最小可访问组件集（components/ui/*），样式仅 `--dsw-*` token；不复制官方 CSS、不冒充官方件名；与 ImageLightbox 先例同构（rc8 未公开→自有实现）。色值豁免面＝SMMP 渲染数据模块与导出产物模板两处文件级白名单。

## (f)(g) 开工前置核查结果 ⟨R1-1⟩⟨R1-2⟩

- **core.ts 浏览器安全性**：`grep '^import' src/core.ts` 零命中——纯同构模块。客户端直接 import buildMindmap 构建文档后 POST /maps，无需 host 包装。（§11 POST /maps 本地快速创建路径成立。）
- **列表 scope 语义**：routes.ts:354-368 已实现 `scope=session|workspace`＋sessionId＋workspaceKeyOfSession 推导。R1-2 的包装器备案**不需启用**，routes.ts 保持零改动。

## 附：W1 装配面核查（实施输入）

canonical 面齐备：createChatMindmapTools(tools.ts)、registerMindmapRoutes(ROUTES_VERSION=5)、PanelRunRegistry、createPanelGenerationAdapter/createChatGenerationLauncher(adapters.ts)、buildRegenerationPrompt/runSourceOutlineGeneration/commitGenerationOutcome(generation-executor.ts)。legacy 删除清单：parseGenerateInput 族、startPanelRegeneration 族、presentContent/presentResult 五键旧形、内联 REST handler、windowOrGlobalTimeout。
