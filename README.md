# 🧠 DSH Chat Mindmap

> **在 DSH 里把任何对话、PDF、文档变成可编辑、可导出、可打印的交互式思维导图。**

一个插件，三个能力：

| 💬 聊天生成 | ✏️ 可视化编辑 | 🖨️ 结构化导出 |
|---|---|---|
| Agent 后台异步生成，不阻塞对话 | SimpleMindMap 全功能画布 | A3 打印 / JSON / MD / XMind / PNG |

## ⚡ 安装（一条命令）

```bash
dsh plugin --profile web add github:EricWang1358/dsh-chat-mindmap
```

重启 DSH Web 即可使用。无需本地构建。

**最低版本：DSH 0.1.0-rc.8** · Node ≥ 22.18

## 🎯 为什么用这个插件？

- **零阻塞生成** — Agent 发起后台 Job，你继续聊天，脑图好了自动出现预览卡
- **全功能画布** — 拖拽/缩放/折叠/展开/节点备注/撤销/重做/全屏，基于 SimpleMindMap
- **会话优先** — 默认只看当前会话的图；一键切到整个工作区浏览全部
- **智能重新生成** — 补充要求后 fork 子代理重建大纲；旧版本一键恢复
- **A3 打印就绪** — 四种风格预设（经典/极简/创意/学术），自包含 HTML 零外链
- **安全降级** — 缺什么能力就关什么功能，绝不崩溃
- **中英双语** — 自动跟随系统语言

## 📋 核心操作流

```
聊天输入 → generate_chat_mindmap → 后台 Job → SVG 卡片 → 点击打开脑图页
                                                                    ↓
面板新建 ← 粘贴文本/MD → 本地构建 → 保存入库                    编辑画布
                                                                    ↓
···菜单 → 导出/归档/删除/恢复                              重新生成(fork)
```

## 🛠 功能矩阵

| 能力 | 状态 | 说明 |
|---|---|---|
| 聊天后台生成 | ✅ | fork/spawn 子代理 + dsh-jobs 异步 |
| 面板本地创建 | ✅ | 粘贴文本/Markdown 同构构建 |
| SimpleMindMap 画布 | ✅ | 拖拽/缩放/折叠/全屏/小地图/键盘导航 |
| 自动保存 (700ms) | ✅ | AbortController + 序号围栏防旧回写 |
| 乐观并发 (CAS) | ✅ | expectedRecordVersion + MINDMAP_CONFLICT 刷新 |
| Fork 重新生成 | ✅ | 三要素 Modal（补充要求+来源提示+确认） |
| 恢复上一版本 | ✅ | 原子交换 current/previous |
| A3 打印导出 | ✅ | 四主题 × 分页 × 目录 × 笔记列 × 溢出报告 |
| Quiz 题目页 | ✅ | 选择/判断/填空/简答 + 来源校验 |
| 设置卡 | ✅ | 官方 Plugins tab；只影响新图 |
| 中英双语 | ✅ | 字典完整性脚本断言零缺键 |
| 能力降级 | ✅ | §15 六行逐行 fake 驱动测试覆盖 |

## 🔧 技术栈

SimpleMindMap · React 18 · TypeScript · tsdown · schemastery settings · cordis effects

## License MIT
