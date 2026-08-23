# S3 设计增量评审与前置裁决记录

- 性质：Phase 3（Tools、Routes、Chat Card）开工前裁决，对应 v3 计划任务 S3-W0
- 输入：TECHNICAL_DESIGN §10/§11/§12/§18/§20、S2 冻结项与移交清单、gate0.mjs 契约、工区对账（见 `docs/plans/S3_PLAN_v3.md` §2）
- 结论：三项全部裁决完毕，**无剩余阻塞项，S3 可进入实施**

## (a) client 组件测试设施缺失下的 ToolCard 测法

- **问题**：仓库无组件测试设施；硬约束禁止引入新依赖与测试框架；WBS 却要求四状态/aria/img-only/LRU 等机器可判断言。
- **备选对比**：
  1. 仅源码正则断言——能锚定写法不能证明渲染结果，弱；
  2. 引入组件测试库——违反硬约束，禁；
  3. **纯逻辑抽离＋react-dom/server renderToStaticMarkup 结构断言**（采纳）。
- **结论**：采纳方案 3。分层：①状态机/LRU/payload 解析/focus-trap 全部抽为纯函数，node assert 直测；②DOM 结构用 renderToStaticMarkup 断言（react/react-dom 已是 devDependencies，`node_modules/react-dom/server.js` 存在已核实，零新增依赖）；③useEffect 不执行→Esc/焦点恢复等副作用行为降级为源码契约锚点（keydown Escape、restoreFocusRef），live 归 G0-4/G0-5 runbook。**绝不把静态结构断言声称为 DOM 行为验证（R14）。**
- **前置核查项**：tsconfig.json 现无 jsx 配置（已核实）——W4 提交内加 `"jsx":"react-jsx"` 并同提交验证 typecheck+build 双绿（R15）；react/jsx-runtime 已在 tsdown CLIENT_EXTERNALS 白名单。

## (b) index.ts 装配边界归本阶段还是集成

- **问题**：§11 要求「路由实现移入 routes.ts，index.ts 只装配」；但 §20 Phase 3 文件清单不含 index.ts，S2 移交第 1 条明确接线替换归集成 Agent。
- **备选对比**：
  1. S3 直接改 index.ts 装配新模块——破坏文件所有权链路，且让 legacy 兼容证明（index.test.mjs 黄金断言）失去对照物；
  2. 新旧路由并行挂载双 prefix——双实现同时 live 增大攻击面与漂移面；
  3. **S3 只交付可装配工厂（tools/routes 导出 register/create 函数＋fake 驱动全量测试），index.ts 冻结，集成期一次性切换**（采纳）。
- **结论**：采纳方案 3。风险接受：真实 DSH 会话中异步 launcher 在集成切换前不可见——live 验证本属 runbook（G0-4-live/G0-6-live 维持 PENDING_LIVE 不变）。legacy 等价性由冻结副本＋黄金断言持续锁定。

## (c) E2E 用 fake jobs runtime 的驱动方式

- **问题**：owned Job 完成通知由官方 tool-jobs 投递；进程内测试无法也不应 mock 整个 tool-jobs 插件。
- **备选对比**：
  1. mock tool-jobs 插件 apply——耦合其私有行为，rc8 演进即碎；
  2. 真 LocalJobRegistry（gate0 G0-3-fixture 方式）——可行但把 jobs-local 实现细节拉进插件测试面；
  3. **FakeJobsService 按 @deepseek-ai/dsh-jobs 公开类型契约自建**：start(spec:JobStart)→id 计数、run()→JobHooks{cancel,done}、settle 助手结算 JobOutcome、read(id) 返回 {text,snapshot}，全程计数可断言（采纳）。
- **结论**：采纳方案 3。完成通知路径以「settle → snapshot → owner 收通知 → read 取 output」模拟官方链路的插件侧义务；官方投递语义（wakeup/inject）不复制、不声称覆盖，归 G0-3-live。fake 与生产共享同一契约键集（kind/label/owner/outputLimitBytes/run/done/output/detail）。

## 随 W0 一并落盘
- **F-S3-1 修复**：`src/domain/records.ts:96` 注释 mojibake（原始字节 A1 EC → C2 A7，恢复 `§9.1` 字面量）；read 工具拒读该文件的问题随之消除。字节级单点替换，git diff 仅 1 行。
- **DEVIATIONS 日志开立**：`docs/plans/S3_DEVIATIONS.md`（初始三条登记见该文件）。

第 2 节产品约束零改动。
