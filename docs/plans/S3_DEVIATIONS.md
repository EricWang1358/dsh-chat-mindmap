# S3 偏差决策记录

按 `docs/plans/S3_PLAN_v3.md` 偏差协议维护。每条含：偏差/原因/备选对比/结论。

## D-S3-1（W0）：工区未跟踪残留文档

- **现状**：`SUBAGENT_DIVISION_OPTIMIZED.md`（S0/S1 时期编排文档）未跟踪滞留于仓库根。
- **备选**：(a) 删除——非本阶段产物，处置权存疑；(b) 提交入库——内容已被 docs/plans/ 正式记录取代，入库制造冗余真相源；(c) 保持未跟踪不动＋登记（采纳）。
- **结论**：采纳 (c)。该文件不参与任何门禁与构建；集成期由用户决定去留。

## D-S3-2（W0）：F-S3-1 mojibake 修复

- **事实**：`src/domain/records.ts:96` 注释中 `§` 字符以损坏字节 A1 EC 存在，导致 read 工具拒读整个文件（invalid UTF-8），tsc 以替换符容错通过。
- **处置**：字节级单点替换 A1 EC → C2 A7；git diff 恰 1 行；修复后 read 工具恢复可读。随 W0 提交落盘。

## D-S3-3（B 节）：S3 新测试链插位

- **偏差**：package.json scripts.test 将依次插入 tools/routes/card/integration 四个测试文件，位置在 host 之后、index 之前，index 恒末位。
- **备选**：(a) 并入既有测试文件——职责混杂且单文件膨胀；(b) 独立文件＋插链（采纳）。
- **结论**：采纳 (b)，引 D1 先例（单 Agent trunk 无冲突面，不新增依赖）。各任务提交内逐个落位。

## D-S3-4（W0，过程记录）：build 门禁的 npm 缓存重定向

- **事实**：本机 npm cache 位于 D:\Program Files\nodejs\node_cache（Program Files 下）；受限运行环境对该路径无写权限时，npm pack --dry-run（build.mjs 第三步）静默 exit 1 且零输出。
- **处置**：S3 起门禁统一以 $env:npm_config_cache 指向仓库内 .npm-cache/（.gitignore 已有该条目）调用 build；修复 records.ts 后全量门禁 test/typecheck/build 实测 exit 0。

## D-S3-5（W1）：launcher 入参校验的瘦身规范副本

- **偏差**：`src/host/tools.ts` 内含 source/config/context 的轻量校验副本，而冻结 index.ts 另有更全的 legacy parser。
- **原因**：§4.1 禁复制的是 prompt/保存逻辑；入参校验属请求面胶水，且 launcher 六字段与 legacy generate 四字段本就不同形。
- **备选**：(a) 复制 legacy parser 全量——携带无关的 save 布尔等旧语义；(b) 瘦身规范副本＋集成期删除旧副本（采纳）；(c) 抽共享 util——两套语义不同形，抽象名不副实。
- **结论**：采纳 (b)。注释中已标注 D-S3-5；集成切换时以本副本为准。

## D-S3-6（W1）：已有 map 的 config 覆盖语义

- **裁决**：对已存在 libraryId 的 chat 再生成，一律使用 record.config（per-map 设置），调用方传入的 config 仅对新图生效。
- **依据**：产品约束「全局设置只影响新脑图」的同构延伸；测试断言 existingSave.config.maxNodes===record 配置值。

## D-S3-7（W1，过程记录）：git add -A 提交卫生教训

- **事实**：W1 提交时 `git add -A` 将未跟踪残留文档（违反 D-S3-1）与 tests/.err.txt、tests/.out.txt 调试残留一并带入（b5be4fe 初版）。
- **处置**：未推送状态下立即 git rm --cached ＋ amend；此后所有提交改为**显式路径 add**。与 DEV-S2-5 同族：门禁/提交动作必须显式、可枚举。

## D-S3-8（W6）：panel-runs disposeAll 语义升级与 S2 黄金断言修订

- **冲突**：S2 黄金断言（host.test.mjs）锁定 disposeAll 后视图仍可 get；W6 规格（R2-2 dispose 归零）要求 `disposeAll 后 panelRuns.size()===0`。两者不可同真。
- **裁决**：以 v3 计划 W6 为准——disposeAll 升级为「abort + quiesce + 清空 runs/controllers/completions」；get 落空、getViewOrInterrupted 退回中断文案（与未知 runId 同路径）。S2 黄金断言同步改写为新语义的双断言。
- **代价**：卸载后旧 runId 查询从「残留视图」变为「生成已中断」，对用户呈现等价（reload 场景本就如此）。

## D-S3-9（W4）：卡片主题表本地副本

- **偏差**：MindmapToolCard.tsx 内含 THEME_PRESETS 的逐字副本（CARD_THEME_PRESETS），而非共享导入。
- **原因**：index.ts 静态导出会引入 import 环；从 mindmap.ts 导入则破坏 simple-mind-map 惰性加载设计。
- **备选**：(a) 共享模块承载主题表——七文件清单之外新增文件，破坏 SAST 清单口径；(b) 本地副本＋来源注释＋Phase 4 删除内联面后收敛为单一真相源（采纳）。
- **结论**：采纳 (b)。集成切换删除 index.ts 内联卡片路径后，仅剩画布侧一份表，漂移窗口封闭。

## D-S3-10（W7）：gate0 G0-5 源契约锚点随组件化迁移

- **事实**：G0-5 断言 `role: 'dialog'`/`URL.revokeObjectURL`/`aria-label` 位于 src/client/index.ts；W4/W5 组件化后 dialog 契约移至 preview/dialog.tsx、对象 URL 生命周期移至 components/blob-url-lru.ts。
- **处置**：锚点按新模块位置改写（JSX `role='dialog'`），断言语义不变；gate0 实测 exit 0。属计划内重构的机械跟随，非契约放宽。

<!-- 后续条目按 D-S3-N 编号追加 -->
