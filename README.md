# 🧠 DSH Chat Mindmap

> 把 DSH 对话上下文变成可编辑、可协作整理、可导出的思维导图。

[![npm](https://img.shields.io/npm/v/@ericwang1358/dsh-chat-mindmap?label=npm)](https://www.npmjs.com/package/@ericwang1358/dsh-chat-mindmap)
[![license](https://img.shields.io/npm/l/@ericwang1358/dsh-chat-mindmap)](LICENSE)

DSH Chat Mindmap 是一个公开发布的 DSH Web 插件。它把 Agent 已掌握的对话上下文整理成结构化脑图，并提供会话范围浏览、画布编辑、版本恢复、重新生成与多格式导出能力。

## 安装

### 在 DSH Web 中使用（推荐）

```bash
dsh plugin --profile web add github:EricWang1358/dsh-chat-mindmap
```

重启 DSH Web 后，在会话的 **脑图** 标签中打开工作台。

### 作为 npm 依赖安装

```bash
npm install @ericwang1358/dsh-chat-mindmap@latest
```

适用于将插件纳入自己的 DSH composition 或发布流程。最新公开版本以 [npm Registry](https://www.npmjs.com/package/@ericwang1358/dsh-chat-mindmap) 的 `latest` tag 为准。

## 60 秒上手

1. 在 DSH 对话中调用 `generate_chat_mindmap`，或让 Agent 根据当前上下文生成脑图。
2. 生成完成后，聊天中的操作卡会直接打开对应脑图页；不依赖聊天容器中的图片预览。
3. 在 **脑图** 标签中编辑节点、添加备注、切换布局或主题；修改会自动保存。
4. 首次进入空会话时，脑图页会打开三步引导：从内容创建、在画布整理、按格式导出。引导只连接已有的工作台操作，不会伪造聊天侧能力。
5. 使用 **更多操作** 导出、归档、恢复版本或重新生成。

## 你会得到什么

| 从聊天到结构 | 可编辑工作台 | 可交付输出 |
|---|---|---|
| 后台 Job 异步生成，不阻塞继续对话 | SimpleMindMap 画布，支持节点编辑、备注、折叠、撤销/重做与全屏 | PNG、Markdown、JSON、XMind，以及 A3 打印 HTML |

## 核心能力

- **会话优先，工作区可见**：默认只显示当前会话脑图；可切换到整个工作区。所有读取与写入都受 session/workspace identity fence 保护。
- **稳定协作**：自动保存使用取消与序号围栏；并发编辑使用 `expectedRecordVersion` CAS，冲突后刷新而非静默覆盖。
- **智能重新生成**：可附加补充要求，通过 DSH fork 子代理重新整理；运行中的任务可取消，旧版本可恢复。
- **设计化画布**：深色磨砂玻璃工作台、固定宽度范围切换和键盘可访问的三步指南；可从工作台“指南”或插件设置重新打开，减少首次使用的不确定性。
- **能力可降级**：DSH 未提供 jobs、subagents 或 settings 时，相关入口会明确禁用，不影响脑图工作台加载。
- **中英双语**：自动跟随 DSH/浏览器语言偏好。

## 使用流程

```text
聊天上下文 → generate_chat_mindmap → 后台生成任务 → 操作卡直达脑图页
                                                   ↓
当前会话 ↔ 整个工作区 → 编辑 / 自动保存 / 版本恢复 / 重新生成
                                                   ↓
                                      更多操作 → 导出 / 归档 / 删除
```

## 兼容性与边界

- 运行环境：DSH Web、Node.js `>=22.18.0 <23`。
- 生成能力依赖宿主提供的 Agent、jobs 与 fork/subagent 服务；没有这些可选能力时仍可浏览、编辑和导出已有脑图。
- 插件不会新增第三方数据传输服务；生成内容使用你现有 DSH Agent/provider 配置，脑图记录按 workspace 作用域保存。
- 聊天结果使用可访问的“打开脑图”操作，不再把 PNG/SVG 预览作为聊天容器的关键路径。

## 为贡献者准备

```bash
npm ci --legacy-peer-deps
npm run typecheck
npm test
npm run verify:sast
node scripts/verify-release-readiness.mjs
npm run verify:package
```

完整发布门禁还包括 `npm run verify:sast` 与 `npm run verify:bundle`。请不要使用 `npm audit fix --force` 改写锁定依赖；依赖升级应独立提交并经过完整 CI。

## 支持与许可

- 源码与问题反馈：[GitHub Repository](https://github.com/EricWang1358/dsh-chat-mindmap) · [Issues](https://github.com/EricWang1358/dsh-chat-mindmap/issues)
- 发布包：[npm](https://www.npmjs.com/package/@ericwang1358/dsh-chat-mindmap)
- 许可：[MIT](LICENSE)
