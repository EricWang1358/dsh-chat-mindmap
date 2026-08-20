# DSH Chat Mindmap

## 0.1.1 已实现并稳定化

### 生成与聊天
- `generate_chat_mindmap`：从 Agent 提供的聊天、文本、PDF、图片或文档上下文生成脑图
- 面板内官方 `fork` 子代理重新生成；不创建 DSH Job、不写入主聊天、不追加聊天 SVG
- 节点备注以 bounded JSON 参考数据进入整图重新生成提示词，不会被当作节点标题
- 重新生成只在 `updatedAt` 未发生冲突时旋转 `current` 到 `previous`
- `present_chat_mindmap` 返回 `libraryId + revisionId`；只保留 `current + previous` 两代历史预览，过期后明确显示失效
- SVG 结果使用插件自有可访问预览 dialog

### 脑图工作区
- 228px 搜索图库，支持活动/归档列表和懒加载请求去重
- 单一 Header：撤销、重做、节点属性、低频操作、全屏
- Canvas-first 工作区；Inspector 为浮层，不改变画布宽度
- 画布沿宿主可用空间动态占满，不依赖固定 480px 高度
- ResizeObserver 只观察宿主 viewport，并通过 rAF 同步 SimpleMindMap 尺寸
- renderer host 使用有限 flex 尺寸和 absolute inset，避免下边界无限扩展
- 初始渲染前只展开根节点与前两层，深层分支按 render-only copy 折叠，不修改持久化数据
- 默认主题跟随 DSH shell 明暗；布局与主题即时应用

### 编辑与创建
- 节点标题和备注编辑、自动保存、节点属性浮层
- 浏览器原生全屏编辑；SimpleMindMap inline contenteditable 挂入 fullscreen 容器
- 创建流程分为“生成草稿 → 保存提交”，生成阶段可取消，保存提交阶段不误报未保存
- JSON、Markdown、XMind、PNG、SVG 导出
- Ctrl+滚轮和右下角缩放按钮

### 持久化与边界
- Host 原子 JSON 写入与串行写队列
- 用户手动编辑只更新 `current`；重新生成才根据策略更新 `previous`
- 插件不保存聊天、附件或原始来源正文
- 仅依赖 DSH 0.1.0-rc.8 公开 API，optional 能力缺失时降级

## 0.1.1 已知限制

- 多选节点尚未提供批量编辑语义；Inspector 目前面向单节点
- 全屏表单和普通 Inspector 仍有部分 UI 状态分离
- ResizeObserver、全屏、短视口和 Inspector 遮挡仍需在现有 DSH GUI 中做浏览器验收；当前已通过源码契约、Host 测试和构建验证
- 工具卡 `call=null` 的完整历史窗口浏览器重放仍是 live evidence 待办
- 项目仍是单文件 client 组合，尚未拆分为 0.2.x 规划的组件目录

## 0.2.x 路线图（不属于 0.1.1）

### 节点上下文工作流
- 选中节点后显示 `＋ 子主题 / ✦ Agent / ···` 上下文菜单
- 多选节点与批量操作
- 节点路径、聚焦分支和小地图导航

### 节点级 Agent
- 展开节点、补充细节、解释概念、提炼行动项
- 使用结构化 node patch，不直接覆盖整张脑图
- Agent 结果先预览，再确认应用

### 统一历史
- 手动编辑、布局、主题和 Agent patch 进入统一历史
- 版本差异、任意版本恢复和可解释撤销
- 评估并设计长期 revision retention；0.1.1 不引入 48 条持久化快照迁移

### Notability 风格内容层
- 节点备注卡片、Markdown、checklist、引用、来源回链
- Agent 指令与节点备注联动
- 全屏节点工具栏与自适应浮层定位

## rc8 兼容与质量保障

- 仅使用公开 DSH API，不依赖私有编译产物
- TypeScript 类型检查、声明编译、Core / Library / HTTP 测试
- package、bundle budget、Gate 0 契约验证
- GitHub Actions CI
