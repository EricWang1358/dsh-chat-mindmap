# Changelog

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
