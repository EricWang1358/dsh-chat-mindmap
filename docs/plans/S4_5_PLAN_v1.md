# S4.5 计划 v1 — 结构化导出与学习闭环

> 基线：S4 末端 7680c73。上游锚定：TECHNICAL_DESIGN §20 Phase 4.5、§13.4、§15；用户任务表 A2。

## 目标与非目标

**目标**：MindmapDoc 规范化层、A3 横向打印 HTML 导出（每主干分页＋封面目录＋右侧笔记＋溢出报告）、classic/minimal/creative/academic 四套风格预设、可选题目页（选择/判断/填空/简答）、mindmap-builder 方法 skill、性能双证据。

**非目标**：修改已有聊天卡或脑图画布行为；新增 npm 运行时依赖；npm publish/tag（S5 后人工）；dsh-IDE 集成（仅可选预览器）。

## W0 设计增量裁决

### (a) MindmapDoc 层级映射规则

从 MindmapNode 树到打印文档的映射：root→封面标题；一级子节点→主干(branch)，每个主干独占一个 A3 分页；二级子节点→分组(group)；三级→条目(item)；四级及更深→子条目(sub-item)；节点 note→右侧笔记列内容。深度截断：超过四级的内容降级为 item 内联文本，不丢弃，在溢出报告标注。

### (b) 溢出报告可解释口径

溢出定义为「单个分支渲染高度超出 A3 可用高度」或「单个条目文本宽度超出可用宽度」。报告以列表形式列出：溢出类型(height/width)、节点路径(>分隔)、超出比例(百分比)。不自动截断——由使用者决定是否精简。

### (c) 导出入口点

客户端生成完整自包含 HTML 并通过 Blob URL 打开新窗口供打印。纯函数生成器位于 `src/host/export/print-html.ts`（同构无 Node API），客户端薄包装位于 `src/client/export/print.ts` 负责触发下载/打开。不新增 REST 端点。

### (d) 风格预设

`src/host/export/themes.ts` 导出 four preset 对象：classic(衬线+暖色)、minimal(无装饰+黑白)、creative(圆角+亮色)、academic(双栏+脚注编号)。每个预设定义 CSS 变量集与页面参数(A3 尺寸/边距/栏数)。

## WBS

| 任务 | 改动文件 | 验收(Given/When/Then) | 复杂度 |
|---|---|---|---|
| W0 评审 | 本文件＋v2/v3 | 三裁决落盘；产品约束零改动 | S |
| W1 mindmap-doc | domain/mindmap-doc.ts; tests/mindmap-doc.test.mjs | 表驱动：正常树→doc 映射正确；超深树显式失败含路径信息；空树失败；note 为非 string 时失败。Given 合法 MindmapNode 树 When normalizeDoc Then 返回带 branches/groups/items/subItems/sources 的结构 | M |
| W2 print-html | host/export/{print-html,themes}.ts; tests/export-golden.test.mjs | Given doc+theme When renderPrintHtml Then 输出包含 cover/toc/pages/notes/overflow 五段结构；golden fixture 对照（首运行写入 fixtures 目录后续 diff=0）；四主题各产出不同 CSS 变量集 | L |
| W3 quiz | domain/quiz.ts; tests/quiz.test.mjs | 四题型 schema 校验表驱动；答案一致性（选择题 answer∈options、判断题 answer∈[true,false]、填空题 blanks.length===answers.length）；nodeId 存在于 doc 中；预览状态机 idle→draft→validated→preview→exported 表驱动 | M |
| W4 安全 | print-html.ts 内部; tests/security-export.test.mjs | 注入样例表驱动：<script>alert</script>、<img onerror>、javascript: href、template literal injection 均被 escape；输出 HTML 无 <script> 标签（除内联打印控制脚本）、无 http(s) 外链引用；sast 扫描 export 文件零 innerHTML | S |
| W5 skill | skills/mindmap-builder/SKILL.md | 工作流四阶段文件存在且含调用契约说明；不被任何代码 import（纯文档） | S |
| W6 性能＋验收 | scripts/benchmark-export.mjs; docs/evidence/ | ≥100 主干×50 条目 fixture：预算估算（HTML 字符串构建耗时）<1s 写入 JSON；浏览器真实打印渲染标 PENDING_LIVE；golden/sanitizer/quiz/smoke 全绿 | M |

## B 节 门禁策略

- 回归网持续冻结：index 恒末位；新增测试插链于 settings 之后 index 之前。
- 门禁：每任务 test/typecheck/build；阶段末 verify:sast/package/bundle/gate0 全绿。
- 性能数字凡不可本机判定者标 PENDING_LIVE，禁止声称未执行验证。
- 提交纪律：Conventional Commits；显式路径 add；每提交列行为变化与未验证边界。

## C 节 风险增量（续接 R18）

| 风险 | 缓解 |
|---|---|
| R19 大文档 HTML 构建内存峰值 | 分页逐段构建避免一次性 concat 全量字符串；benchmark 监控 heapUsed |
| R20 golden fixture 与实现耦合过紧导致脆弱测试 | golden 仅锁定结构骨架（cover/toc/pages/notes/overflow 五段标签存在），不锁全文 hash |
| R21 Agent 输出注入绕过 escape | escape 函数覆盖 text/attr/URL 三个面；注入样例表驱动含多语言 payload |

## 提交切分

1. docs(plan): S4.5 plan v1-v3 (Refs: S45-W0)
2. feat(domain): MindmapDoc normalization layer (Refs: S45-W1)
3. feat(export): A3 print HTML generator and themes (Refs: S45-W2)
4. feat(quiz): quiz schema validation and preview state machine (Refs: S45-W3)
5. feat(security): escape coverage and self-contained HTML gate (Refs: S45-W4)
6. docs(skill): mindmap-builder method workflow (Refs: S45-W5)
7. chore(benchmark): export perf evidence; S4.5 stage report (Refs: S45-W6)
