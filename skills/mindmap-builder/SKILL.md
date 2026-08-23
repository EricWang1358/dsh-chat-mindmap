# Mindmap Builder 方法论

本 skill 固化从来源材料到高质量脑图的四阶段工作流。适用于 dsh-chat-mindmap 插件的生成与重新生成链路。

## 调用契约

Agent 收到 `generate_chat_mindmap` 或面板 regenerate 请求时，按以下阶段顺序处理。输出必须为符合 `OUTLINE_OUTPUT_SCHEMA` 的 JSON（title + outline），不得调用工具或解释过程。

## 四阶段工作流

### 1. 来源提取（Source Extraction）
- 从聊天上下文/PDF/附件中提取关键概念、事实、结论。
- 保留来源类型信息（text/pdf/image/document/chat）供溯源。
- 忽略寒暄、重复和与主题无关的内容。

### 2. 知识组织（Knowledge Organization）
- 识别层级关系：主题 → 主干(3–7个) → 分组 → 条目。
- 每个条目附带简短备注(note)说明上下文或补充细节。
- 同层条目保持粒度一致；避免过深嵌套（≤4 层）。

### 3. 渲染（Render）
- 将大纲转换为 Markdown 层级格式（# ## ### -）。
- 确认节点数不超过 maxNodes 上限（默认 360）。
- 标题简洁（≤60 字符）；备注可更长但注意预算。

### 4. 溢出修正（Overflow Correction）
- 检查导出溢出报告：width 溢出=单条目 >500 字符需精简；height 溢出=分支子项 >80 需拆分。
- 如收到溢出报告，优先合并同义条目或提升至父级摘要行。

## 输出格式

只输出 JSON：{"title": "根标题", "outline": "Markdown 大纲"}。outline 使用 # 作为根标题行。
