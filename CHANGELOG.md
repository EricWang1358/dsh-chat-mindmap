# Changelog

## 0.2.7 — 2026-08-25

### Fixed

- 修复脑图面板「重新生成」时，client 端轮询门闩仅匹配 `running`，错过 `accepted` → `running` → `completed` 的转换，导致子代理结果从未写回原脑图。门闩扩到 `running | accepted`，并同步 `regenerateUnavailableWhileRunning` 谓词、顶栏 cancel 按钮以及 `PanelRunView.status` 类型分支。
- 增加 panel-run 轮询的陈旧响应守卫（`shouldDropPanelRunResponse` + `panelRunRef`/`refreshRef` 镜像），防止用户取消或重新启动 run 后，旧请求的迟到响应覆盖了用户已切换的脑图或更新后的新 run。
- 重新生成完成时立即用服务端新 `countMindmapNodes` 同步 sidebar / header 节点数与 title / source / updatedAt，避免后台 gallery 刷新到达前 header 仍显示旧计数。
- 脑图节点数 `nodeCountOf` 统一收敛到 `core.ts` 的 `countMindmapNodes`，client 端复算与 server `summaryOf` 永远一致。
- 增加覆盖 `accepted → running → completed` 状态机、`shouldDropPanelRunResponse` 陈旧响应守卫、`countMindmapNodes` 一致性的针对性自动化测试。

### Compatibility

- devDep 范围由 `^0.1.0-rc.8` 升至 `^0.1.1-rc.2`，跟 DSH `next` 通道最新同步；`npm ci` 严格按 lock 装 0.1.1-rc.2，不再吃旧版 0.1.0-rc.8。
- peerDep 仍保持 `>=0.1.0-rc <2`：宿主机实际安装的 DSH 若是 0.1.0-rc.8、0.1.1-rc.X、或未来任何 `<2` 的稳定/预发布，plugin 都会按 host 实际版本正常工作。这就是 0.2.7 "同一份 plugin 同时跟 DSH 0.1.0-rc 和 0.1.1-rc 两个分支" 的兼容性卖点。

### Verification

- typecheck、declaration compilation、client bundle、Core/Library/HTTP/Panel-regenerate-fix tests、SAST、bundle budget、release-readiness 与 0.2.6 同样的 gate 全部通过。

## 0.2.6 — 2026-08-25

### Added

- Add an interactive three-step MVP guide for the mindmap workspace: create from content, refine on the canvas, then export in the required format.
- Show the guide automatically for a first-time empty session, offer replay from the workspace toolbar and plugin settings, and persist dismissal through the official DSH settings scope when available.
- Link each guide step to a real workspace action: scoped create-from-text, node properties, or More actions.

### Improved

- Replace the permanent three-card empty-state explanation with a calmer empty workspace and a dedicated, keyboard-accessible walkthrough that restores focus when closed.

### Verification

- TypeScript typecheck, full automated tests, package verification, bundle budget, SAST, release-readiness checks, and GitHub Actions CI are required before release.

## 0.2.5 — 2026-08-24

### Fixed
- 修复脑图自动保存、外观配置保存和冲突刷新缺少 session scope，导致编辑结果无法提交的问题。
- 为详情、revision、归档、恢复、删除、重新生成和 panel-run 操作统一增加 workspace 归属校验。
- 修复重新生成的 `expectedRecordVersion` 未传入执行器，避免并发修改被覆盖。
- 新建脑图必须解析到真实 workspace；无法解析时明确拒绝，旧的 `legacy-unscoped` 数据仍按兼容路径读取。
- 补齐 `/maps/:id/archive` REST 路由，并加入 live session、workspace 和 CAS 校验。
- 修复切换会话后图库缓存和当前脑图详情未重新加载的问题。
- 修复聊天 SVG 预览卡读取 scoped revision 时缺少当前 sessionId 的问题。
- 聊天工具生成和预览统一增加 workspace identity fence，避免跨工作区读写脑图。
- 兼容部分模型无法调用 `structured_output` 时返回的合法 JSON 文本，同时继续执行严格 outline schema 校验，避免误报 `GENERATION_FAILED`。
- 接受根标题加 Markdown bullet 子节点的合法树状大纲，修复模型返回列表式树结构时误报 `INVALID_AGENT_OUTLINE`。
- 兼容 `structured` 结果为 JSON 字符串或有限层级 data/value/result/output/content 包装的模型路由返回。
- 聊天预览改为 PNG 优先、SVG 回退，并将导出画布固定为 1280×720、卡片图片限制为 620×360，避免 SVG 在聊天容器中显示异常。

### Verification
- 完整测试、TypeScript typecheck、发布包校验、bundle budget 和 SAST 均通过。

## 0.1.1 — 2026-08-20

### Fixed
- 修复脑图 Canvas 使用固定 `480px` 最小高度导致的短视口和宿主面板布局问题。
- 使用有限 flex 尺寸链和绝对定位 renderer host，避免 Canvas 下边界无限向下扩展。
- ResizeObserver 只监听宿主 viewport，按实际宽高变化通过 requestAnimationFrame 同步 SimpleMindMap，避免 renderer DOM 反馈循环。
- 修正 fullscreen 下 SimpleMindMap `contenteditable` 的挂载位置。
- 修正 Windows 受限环境下 package verification 的 npm pack 输出处理。
- 修正 tsdown 对 DSH public client peer imports 的 external 配置。

### Improved
- 全屏模式支持节点标题和备注编辑。
- 新建脑图区分“生成草稿”和“保存提交”阶段；生成阶段可取消，保存提交不会误报未保存。
- 节点备注以结构化、受 contextLimit 约束的参考数据加入面板 fork regeneration prompt。
- 工作区统一为单一 Header、浮层 Inspector、228px 搜索图库和 Canvas-first 布局。
- 删除无行为的菜单入口和重复隐藏 Toolbar。
- 项目概览、README 和 Gate 0 fixture 与当前实现同步。

### Compatibility
- 继续只使用 `@deepseek-ai/dsh 0.1.0-rc.8` public APIs。
- 持久化继续使用 `current + previous` 两代模型；本版本不引入 48 条 revision 快照迁移。
- 面板重新生成继续是 panel-only official fork，不创建 DSH Job、不写入主聊天、不追加聊天 SVG。

### Verification
- typecheck、declaration compilation、client bundle、Core/Library/HTTP tests、package verification、bundle budget 和 Gate 0 fixture 均通过。
- Gate 0 中需要真实浏览器交互的 replay、SVG dialog 和 optional-service profile 项仍标记为 `PENDING_LIVE`。

## 0.2.x roadmap

- 节点上下文菜单：`＋ 子主题 / ✦ Agent / ···`。
- 节点级 Agent 与结构化 patch preview/apply。
- 多选节点和批量操作。
- 全手动编辑、布局、主题、Agent patch 的统一历史与差异恢复。
- Notability 风格节点备注卡片、checklist、引用和来源回链。
- 评估长期 revision retention；需先完成数据迁移、容量策略和兼容性设计。
