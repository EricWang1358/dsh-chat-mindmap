# S4.5 计划 v2 — 吸收 CRITIC-R1 意见

> CRITIC-R1 八条意见逐条附采纳结论。修订处标注 ⟨R1-n⟩。

## R1 审查意见与结论

### R1-1（P0）：normalizeDoc 的输入源未明确——是从 MindmapNode 直接转换还是独立 schema？
**影响**：若从 Node 树转换，mindmap-doc.ts 依赖 core.ts 类型；若独立则需二次校验。
**采纳**：从已校验的 MindmapDocument 转换，输入即 validateMindmapDocument 的输出。不重复定义节点结构，只定义导出层视图模型（branches/groups/items/subItems/sources）。

### R1-2（P0）：golden fixture 首运行写入后如何防止实现变更时手动更新 fixture 导致的假绿？
**采纳**：golden 测试分两层——结构层（五段标签存在性＋关键 class 名）每次运行硬断言；内容层生成完整 HTML 写入 docs/evidence/export-samples/ 供人工审阅但不做 diff 断言。

### R1-3（P1）：quiz nodeId 校验需要 doc 上下文——quiz.ts 是否应接受 doc 参数？
**采纳**：validateQuiz(quiz, doc) 签名；doc 提供合法 nodeId 集合供交叉校验。

### R1-4（P1）：escapeHtml 应覆盖哪些面？text/attr/URL 三面的正则不同。
**采纳**：导出三个函数 escText/escAttr/escUrl；escUrl 额外拒绝 javascript:/data:/vbscript: 协议。

### R1-5（P1）：预览状态机是纯函数还是组件状态？
**采纳**：纯函数 transitionQuizState(current, event) 导出供测试与组件共用。

### R1-6（P2）：四套主题是否需要独立的 CSS 文件？
**采纳**：不需要。每主题是一个对象含 cssVars 字典，renderPrintHtml 内联 <style> 输出。

### R1-7（P2）：skill 文件的语言？
**采纳**：中文为主（与项目文档一致），关键词保留英文。

### R1-8（P2）：benchmark-export 与 benchmark.mjs 是否合并？
**采纳**：合并到 scripts/benchmark.mjs 增加导出段；不新建文件。

## 修订后的 WBS 变更点

- W1 normalizeDoc(doc: MindmapDocument) → ExportDoc（不再接受裸树）
- W2 golden 分两层（R1-2）；themes.ts 导出 preset 对象数组非 CSS 文件
- W3 validateQuiz(quiz, doc) 签名；transitionQuizState 纯函数导出
- W4 escapeHtml 拆三函数；escUrl 协议白名单 http/https/mailto/相对路径
- W6 benchmark.mjs 扩展而非新建
