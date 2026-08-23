# DSH Chat Mindmap 技术设计与实施计划

> 状态：历史设计基线 / 0.2.x 候选，不是 0.1.1 验收清单
> 目标版本：下一次 breaking minor（建议 `0.2.0`）
> 基线：`0.1.0`，2026-08-19 本地 `npm test` 与 `npm run typecheck` 均通过
> 计划用途：记录曾提议的架构方向；0.1.1 继续采用公开 rc8 API、panel-only fork 与 `current + previous` 两代模型，节点级 Agent、patch workflow、统一历史和 revision retention 迁移留到 0.2.x

## 1. 结论摘要

本次重构将当前的“主 Agent 整理内容、同步调用工具、重新生成时把 prompt 写入输入框”改为以下产品模型：

1. 脑图页是创建、查看、编辑和重新生成的主要界面。
2. 聊天发起的语义生成使用 DSH 官方 owned Jobs 和 one-shot subagent。
3. 面板发起的语义生成直接持有官方 one-shot subagent run，避免 Jobs 完成通知污染主聊天。
4. 两种入口共享一个 `GenerationExecutor`，共享 prompt、schema、验证、保存和超时逻辑。
5. subagent 只负责把来源整理成严格 Markdown outline；现有 Core 负责确定性地构建 `MindmapDocument`。
6. 聊天中的最终结果由父 Agent 在收到官方 Job 完成通知后调用轻量展示工具，显示只读 SVG 缩略图。
7. SVG 点击后使用插件自有可访问预览 dialog 放大；DSH 0.1.0-rc.8 未公开导出 `ImageLightbox`，不依赖其私有编译产物，也不提供“打开脑图”按钮。
8. `current + previous` 继续作为唯一编辑版本模型；聊天生成快照同样只保留两代。
9. 设置使用 DSH `settings` namespace 和 `settings.plugin.item`，不自建设置系统。
10. 首版支持中英双语、桌面优先和 workspace 隔离；macOS 在 CI 与实机验证前标为 best-effort。

## 2. 已确认的产品约束

以下均为实现约束，不得由实施 Agent 自行改写：

- 默认后台超时为 180 秒。
- 主聊天不得等待后台生成完成。
- 面板发起的生成不得向主聊天写入消息或 SVG。
- 聊天发起时，先出现官方后台任务记录；完成后追加最终 SVG 工具卡。
- 同一 `libraryId` 同时最多一个生成任务；不同脑图允许并行。
- 任务不跨 DSH 进程重启恢复。
- 插件不保存聊天、PDF、图片或文档的原始正文。
- 来源无法重新解析时必须明确失败，不得使用残缺来源静默重建。
- 用户手动编辑只更新 `current`，不得旋转 `previous`。
- 重新生成将旧 `current` 放入 `previous`；只提供单步恢复，不做时间线。
- 全局设置只影响新脑图，不批量修改已有脑图。
- 默认列表显示当前 session 脑图；“全部脑图”只显示当前 workspace。
- 聊天预览不随手动编辑改变；预览版本超出两代或脑图删除后显示“本图已失效”。
- 不退回“把重新生成 prompt 复制进输入框”的兼容流程。
- 缺少官方能力时明确降级；不自建 Agent、Job 或 Settings。rc8 未公开 `ImageLightbox` 时，使用本插件自有可访问 SVG 预览 dialog，不导入私有编译产物。

## 3. 当前实现审计

### 3.1 已有可复用能力

- `src/core.ts` 已提供确定性 Markdown/聊天文本解析、节点限制、验证和 Markdown 导出。
- `src/library.ts` 已提供原子 JSON 写入、串行写队列、`current + previous`、归档和删除。
- `src/index.ts` 已注册 Host tool 和 REST API。
- `src/client/mindmap.ts` 已按需组装 SimpleMindMap 插件。
- `src/client/index.ts` 已具备编辑画布、自动保存、主题、布局和导出基础。
- 当前测试覆盖 Core、Library 与 HTTP 路由。

### 3.2 必须移除或替换的行为

- 删除 `regenerate()` 中的 `inputActions.setDraft(prompt)` 路径。
- 不再把完整 `MindmapDocument` JSON 嵌入聊天 prompt。
- 不在画布初始化时立即生成 XMind；改为用户点击导出时生成。
- 不再把全部页面、样式、API 和状态集中在 `src/client/index.ts`。
- 不再依赖硬编码中文 UI 文案和本地按钮样式函数。
- 不再把工具的完整 `document + markdown` 作为持久聊天结果；聊天只持久化引用与必要摘要。

## 4. 架构与边界

```text
┌────────────────────────── Chat origin ──────────────────────────┐
│ Main Agent → generate_chat_mindmap → owned ctx.jobs Job         │
│                                      ↓                          │
│                              GenerationExecutor                 │
│                                      ↓                          │
│                            ctx.subagents.start(fork)             │
│                                      ↓                          │
│                           validate → build → save                │
│                                      ↓                          │
│ official Job completion notice → job_output → present_mindmap   │
│                                      ↓                          │
│                           static SVG tool card                   │
└─────────────────────────────────────────────────────────────────┘

┌───────────────────────── Panel origin ──────────────────────────┐
│ BrainmapView → plugin REST API → PanelRunRegistry               │
│                                  ↓                              │
│                          GenerationExecutor                     │
│                                  ↓                              │
│                        ctx.subagents.start(fork)                 │
│                                  ↓                              │
│                       validate → build → save                   │
│                                  ↓                              │
│                      panel state + Toast only                   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 为什么有两个编排适配器

`ctx.jobs` 的 owned Job 完成后会通过 `@deepseek-ai/dsh-tool-jobs` 通知所属 Agent。这正是聊天入口需要的父子通信，却与“面板任务不得写入聊天”冲突。

因此：

- Chat adapter 使用 owned Job，复用官方状态、取消与完成通知。
- Panel adapter 直接持有 `SubagentRun`，只维护进程内 `runId/status/controller` 和 `libraryId` 锁。
- `PanelRunRegistry` 不是任务队列，不做持久化、调度、重试或跨进程恢复。
- 两个 adapter 必须调用同一个 `GenerationExecutor.execute()`，不得复制 prompt 或保存逻辑。

### 4.2 官方接口使用表

| 需求 | 官方接口 | 插件责任 |
|---|---|---|
| 聊天后台任务 | `ctx.jobs.start()` | 定义 mindmap Job hooks 与最终输出 |
| 子代理执行 | `ctx.subagents.start()` | 固定 persona、schema、工具限制、超时 |
| 父 Agent 完成通信 | `@deepseek-ai/dsh-tool-jobs` | Job output 中给出下一步展示指令 |
| 聊天工具卡 | `tool.call.toolview` | 仅注册两个自有工具的 renderer |
| 设置存储 | `ctx.settings.register()` | 定义 `chat-mindmap` schema |
| 设置 UI | `settings.plugin.item` | 绘制插件自己的设置卡 |
| UI 控件 | `dsh-client-ui-primitives` | 业务组合与少量布局 CSS |
| SVG 放大 | 插件自有可访问 SVG 预览 dialog（rc8 无公开 `ImageLightbox`） | 提供 SVG Blob URL、alt、焦点管理、Escape/关闭与 URL 清理 |
| 脑图渲染 | SimpleMindMap | 数据适配、生命周期和导出 |

## 5. 建议的源码结构

```text
src/
├── core.ts
├── library.ts
├── index.ts
├── domain/
│   ├── errors.ts
│   ├── generation.ts
│   ├── records.ts
│   └── settings.ts
├── host/
│   ├── capabilities.ts
│   ├── generation-executor.ts
│   ├── generation-locks.ts
│   ├── panel-runs.ts
│   ├── routes.ts
│   ├── settings.ts
│   └── tools.ts
└── client/
    ├── index.ts
    ├── mindmap.ts
    ├── api.ts
    ├── locale.ts
    ├── styles.css
    ├── components/
    │   ├── BrainmapView.tsx
    │   ├── MapCanvas.tsx
    │   ├── MapList.tsx
    │   ├── MapToolbar.tsx
    │   ├── AppearanceMenu.tsx
    │   ├── RegenerateModal.tsx
    │   ├── GenerationStatus.tsx
    │   ├── MindmapToolCard.tsx
    │   └── MindmapSettingsCard.tsx
    └── preview/
        ├── svg-preview.ts
        └── preview-cache.ts
```

现有 `src/index.ts` 与 `src/client/index.ts` 最终只保留注册和装配逻辑。

## 6. 数据模型 V2

### 6.1 记录结构

```ts
interface GenerationPreviewSnapshot {
  revisionId: string
  document: MindmapDocument
  generatedAt: string
}

interface MindmapRecordV2 {
  schemaVersion: 2
  recordVersion: number
  libraryId: string
  title: string
  workspaceKey: string
  current: MindmapDocument
  previous?: MindmapDocument
  previewCurrent: GenerationPreviewSnapshot
  previewPrevious?: GenerationPreviewSnapshot
  config: MindmapConfig
  source?: MindmapSource
  archived: boolean
  createdAt: string
  updatedAt: string
}
```

规则：

- `current` 是可编辑文档。
- `previous` 是上次重新生成前的可编辑文档。
- `previewCurrent` 是最近一次 Agent 生成完成时的不可变快照；记录创建时即以初始文档快照初始化（创建视为第 0 代生成），因此手动新建的脑图同样拥有稳定预览代次。
- `previewPrevious` 是再前一次 Agent 生成完成时的不可变快照；在第二次生成前不存在。
- 手动编辑只改 `current`。
- Agent 生成同时旋转 `current/previous` 与 `previewCurrent/previewPrevious`。
- 恢复操作只交换 `current/previous`，不篡改聊天预览快照。
- `revisionId` 的规范实现为内容寻址确定性 id（规范化 JSON 的 SHA-256 截断，见 `revisionIdOf`），V1 legacy 迁移与 V2 快照统一使用；它满足「不复用时间戳」与跨读取稳定要求。随机 UUID 派生 id 仅允许在与 revision 路由白名单同步更新的变更中引入。
- `recordVersion` 是每次成功写入都递增的乐观并发版本；自动保存、外观修改、恢复和重新生成都必须带 expected version。

### 6.2 Workspace 隔离

DSH session 的 Host 持久事实是绝对 `cwd`，而非稳定暴露给插件的 `workspaceId`。因此 `workspaceKey` 定义为：

```text
sha256(normalizeWorkspaceCwd(agent.session.header.cwd)).slice(0, 32)
```

- Windows：解析绝对路径、统一分隔符、盘符与路径不区分大小写。
- macOS/Linux：解析绝对路径并保留大小写。
- 不调用 `realpath`，避免已删除 workspace 或网络盘导致读取失败。
- 记录只保存 hash，不新增原始绝对路径泄露。
- API mutation 必须由 live `sessionId → Agent → session.header.cwd` 推导 scope；不信任浏览器提交的 workspace key。
- 没有 cwd 的 session 只允许 session-scoped 列表，不进入 workspace “全部脑图”。

### 6.3 V1 兼容迁移

- `readRecord()` 同时接受 V1 和 V2。
- V1 在内存中补全 `schemaVersion: 2`、`recordVersion: 1` 和确定性 legacy revision id。
- legacy revision id 为当前文档规范化 JSON 的 hash，不使用随机数，保证重复读取稳定。
- 能通过 `source.sessionId` 找到 live session/cwd 时，在下一次写入时补全 `workspaceKey`。
- 无法确定 workspace 的记录保持 `legacy-unscoped`；不得自动归入当前 workspace。
- 首版不增加迁移向导。Settings 卡只显示未归属记录数量和数据目录位置。
- 迁移必须采用原子写入；不得启动时批量改写所有文件。

## 7. 设置模型

Host 注册 namespace：`chat-mindmap`。

```ts
interface MindmapSettings {
  defaultLayout: string
  defaultTheme: string
  defaultDensity: 'compact' | 'standard' | 'detailed'
  defaultMaxNodes: number
  defaultContextLimit: number
  defaultLanguage: string
  focusGeneratedMap: boolean
}
```

约束：

- `applies: 'live'`。
- 设置只在新建记录时合并为 record config。
- 已有记录配置永远优先，不被 settings watcher 批量改写。
- “恢复全局默认”是当前脑图外观菜单中的显式操作。
- timeout、provider、persona、tool filter 与 token 上限不是用户设置；它们属于稳定性策略。

## 8. GenerationExecutor

### 8.1 输入与输出

```ts
interface GenerationRequest {
  origin: 'chat' | 'panel'
  parent: Agent
  libraryId?: string
  title?: string
  supplementalContext?: string
  source: MindmapSource
  config: MindmapConfig
  instruction?: string
}

interface GenerationOutcome {
  libraryId: string
  revisionId: string
  title: string
  nodeCount: number
  workspaceKey: string
}
```

`supplementalContext` 用于当前未完成回合中的新内容或附件提取文本；不得写入 `MindmapRecord`。

### 8.2 Provider 选择

1. 优先使用 provider `fork`，因为它继承父会话的完整已结束回合。
2. `fork` 不可用时，只有 `supplementalContext` 非空才允许回退 `spawn`。
3. 两者都不可用时返回 `CAPABILITY_UNAVAILABLE`。
4. 不自动选择任意第三方 provider，避免语义漂移。

重要限制：fork seed 截止到最后一个 `turn/end`，不包含当前 tool call 所在回合。调用工具的主 Agent 必须把当前回合中新加入的必要正文作为 `supplementalContext` 传入；不得假定 fork 看得到当前附件。

### 8.3 Subagent 配置

- 继承 parent 的 provider/model。
- `maxTokens` 固定上限，编译期稳定性策略常量取 6000（ADR-008）；Gate 0 的 30/120/300 节点样本校准证据归入 live verification runbook，缺失不作为 Phase 2 阻塞项。
- persona：仅做来源到层级大纲的转换，不调用 skills，不讨论过程，不执行副作用。
- `outputSchema`：`{ title: string, outline: string }`。
- `toolFilter`：默认 deny all；只有 Gate 0 证明某来源必须读取官方附件/文件工具时才最小放行。
- 禁止 subagent、job、workflow、skill 等递归/扩展工具。
- prompt 明确 maxNodes、density、language、instruction 和来源边界。
- 180 秒超时由 adapter 的独立 `AbortController` 执行，不复用已经返回的 tool-call signal。
- 必须在 `finally` 中 `await run.dispose()`。

### 8.4 输出验证

- title：1–120 字符。
- outline：非空、最大 200,000 字符。
- 至少包含根标题和一个子标题。
- 标题层级不得一次跳跃超过一级；可在 parser 中规范化，但不得静默丢失根结构。
- 使用严格 `buildMindmapFromOutline()`；Agent 结果不得退回 transcript parser。
- 生成文档再次经过 `validateMindmapDocument()`。
- 节点数超过限制时按 Core 既有规则截断并记录 warning；结构无效则整个任务失败。

## 9. 并发、超时与清理

### 9.1 锁

- `GenerationLockRegistry` key 为 `libraryId`；新建任务使用预分配 `libraryId`。
- 预分配只调用纯函数 `reserveLibraryId()` 生成 id，不提前创建磁盘记录；launcher 可立即把该 id 返回给调用方。
- 锁从任务被接受开始，到 subagent dispose 与保存完成后释放。
- 同 key 冲突返回 HTTP 409 / tool error code `MINDMAP_BUSY`。
- 锁仅进程内存在；重启后自然释放。

生成提交采用单一事务边界：

1. 读取并记住现有 record 的 `recordVersion`；新建任务则记为 absent。
2. 在内存中完成 subagent 输出验证、outline 转换和完整 V2 record 构造。
3. 持锁执行 compare-and-swap；现有 record 已被别的写入改变时返回 `MINDMAP_CONFLICT`，不得覆盖。
4. 使用现有临时文件 + rename 原子写入一次性提交完整 record。
5. 只有提交成功后才发布 completed outcome / Job output。
6. failed、timed_out、cancelled、conflict 或 storage error 时不创建新 record，也不改变旧 `current/previous/preview`。

### 9.2 状态机

```text
accepted → running → completed
                   ↘ failed
                   ↘ timed_out
                   ↘ cancelled
```

- UI 只展示：等待开始、正在生成脑图、完成、失败、已取消。
- 不显示伪百分比和不可观测的“正在保存”。
- 面板 reload 后找不到原 run 时显示“生成已中断”，旧 `current` 保持不变。
- 保存必须发生在 outcome 发布前；看到 completed 就必须能读取新 record。

## 10. Chat 工具协议

### 10.1 `generate_chat_mindmap`

职责改为启动 owned background Job，不直接返回完整脑图。

输入：

- `title?`
- `libraryId?`
- `context?`：当前回合必要正文或已提取来源；不要求主 Agent先组织成脑图。
- `source?`
- `config?`
- `instruction?`

返回：

```ts
{ kind: 'background', jobId: string, libraryId: string }
```

Job 最终 output 必须是紧凑机器可读文本，包含：

```text
mindmap completed: libraryId=<id> revisionId=<id> title=<json-string> nodes=<n>.
Call present_chat_mindmap with libraryId and revisionId.
```

失败 output 包含稳定 error code 与安全用户文案，不包含 stack、路径或原始来源。

### 10.2 `present_chat_mindmap`

这是无模型推理、无写入副作用的轻量展示工具。

输入与返回：

```ts
{ libraryId: string, revisionId: string }
→ { libraryId, revisionId, title, nodeCount, state: 'available' | 'expired' }
```

- Host 验证调用 Agent 的 workspace 与 map workspace 一致。
- `output.render` 给模型返回一句简短成功/失效文本。
- `presentCall/presentResult` 提供稳定标题与包含引用的 generic presentation content。
- Client 在 `tool.call.toolview` 下按工具名注册自定义卡。
- 卡片不得依赖 canonical tool value，因为 canonical value 不进入 durable session event。
- 引用必须同时存在于持久化的 result presentation/content 中，以支持 call head 已被历史窗口裁剪的 replay。

### 10.3 完成通信

- 主 Agent 调用 launcher 后可以立即继续聊天。
- owned Job 完成后由官方 `tool-jobs` 通知父 Agent。
- 父 Agent通过 `job_output` 收集结果，然后调用 `present_chat_mindmap`。
- 不使用 busy polling、sleep 或在原 tool call 中 wait 180 秒。
- System prompt/tool description 只增加最小协议说明，不加入长篇工作流指令。

## 11. Panel API

所有路由前缀保持 `/@ericwang1358/dsh-chat-mindmap`。

| Method | Path | 行为 |
|---|---|---|
| GET | `/health` | 版本与基础可用性 |
| GET | `/capabilities` | jobs/subagents/fork/settings/tool-card 能力 |
| GET | `/maps?sessionId=&scope=session|workspace&archived=` | Host 从 session 推导 workspace |
| GET | `/maps/:id?sessionId=` | workspace 校验后读 record |
| POST | `/maps` | 本地 Markdown/text 快速创建 |
| PATCH | `/maps/:id` | 手动文档、标题、外观、归档；需 session scope |
| DELETE | `/maps/:id?sessionId=` | 删除 record |
| POST | `/maps/:id/restore-previous` | 原子交换 current/previous |
| POST | `/maps/:id/regenerate` | 启动 panel one-shot run，返回 runId |
| GET | `/panel-runs/:runId?sessionId=` | 读取 panel run 状态 |
| GET | `/maps/:id/revisions/:revisionId?sessionId=` | 返回可用快照或 410 |

约束：

- JSON body 上限保持 256 KB。
- map id、revision id、run id 全部使用严格字符白名单。
- mutation 请求必须解析到 live Agent；不存在时返回 409 `SESSION_UNAVAILABLE`。
- 所有已有 map mutation 必须提交 `expectedRecordVersion`；不匹配返回 409 `MINDMAP_CONFLICT` 并由 UI 刷新，不做 last-write-wins。
- GET revision 在 map 删除或超出两代时返回 410 `MINDMAP_REVISION_EXPIRED`。
- API 错误统一 `{ ok:false, error:{ code,message } }`；不得返回 `String(error)` 给 UI。
- 路由实现移入 `src/host/routes.ts`，`src/index.ts` 只装配。

## 12. SVG 预览设计

### 12.1 生命周期

- 磁盘上不保存 SVG；磁盘只保留两代不可变 `MindmapDocument` 预览快照。
- Tool card 按 `libraryId + revisionId` 请求快照。
- Client 使用 SimpleMindMap Export 在隐藏容器中生成 SVG Blob。
- Blob URL 放入进程内 LRU，建议最多 20 项；组件卸载不立即撤销仍在 LRU 的 URL。
- LRU 淘汰或 client dispose 时 `URL.revokeObjectURL()`。
- reload 后重新生成 SVG；旧 revision 超出两代时显示“本图已失效”。

### 12.2 安全与体验

- 只从 Host 验证过的 `MindmapDocument` 生成 SVG，不渲染模型提供的 SVG 字符串。
- SVG 只作为 `<img src=blob:...>`，不 `innerHTML`、不 iframe、不注入 DOM。
- 缩略图是一个带可访问名称的图片按钮。
- 点击使用插件自有可访问 SVG 预览 dialog；不提供编辑、跳转或“打开脑图”按钮。
- 卡片状态：loading、ready、expired、failed。
- SVG 生成失败时显示文本 fallback，不影响聊天其余内容。

## 13. 脑图页 UI

### 13.1 页面结构

- 顶部：页面标题、session/workspace 范围切换、新建。
- 左侧：当前范围脑图列表；窄屏折叠为选择器。
- 右侧：标题、最小工具栏、生成状态、画布。
- 空状态按 session 无脑图、workspace 无脑图、能力不可用分别呈现。

### 13.2 常驻与收纳

常驻：

- 新建
- 重新生成
- 当前任务状态
- 脑图画布

“外观”菜单：

- layout
- theme
- 恢复全局默认

`···` 菜单：

- JSON / Markdown / XMind 导出
- 恢复重新生成前版本（仅有 previous 时）
- 归档 / 恢复
- 删除

重新生成 Modal：

- 补充要求
- 来源不可用提示
- 确认生成

### 13.3 官方组件

- Button、Menu、Modal、Tooltip、Toast、StateDot、Input 使用官方 primitives。
- 图片放大使用插件自有可访问 SVG 预览 dialog；rc8 无公开 `ImageLightbox`，不导入私有编译产物。
- 所有颜色、边框、字体与背景使用 `--dsw-*` token。
- 业务 CSS 只负责网格、尺寸、响应式和 SimpleMindMap 容器。
- 禁止复制官方组件 CSS 或重新实现同名交互。

### 13.4 性能

- 移除画布 mount 时的 eager XMind export。
- XMind/JSON/Markdown 只在点击导出后生成。
- 切换 layout/theme 不重建 MindMap instance。
- autosave 保持 700 ms debounce；新增请求序列或 AbortController 防止旧 PATCH 回写新状态。
- SVG preview 生成不得阻塞脑图主画布。
- 360 节点基准：画布可交互和 SVG 缩略图生成分别记录耗时，目标均小于 1 秒（普通桌面环境）；120 节点作为较小配置档保留。

## 14. 国际化与兼容

- locale namespace：`chat-mindmap`。
- 首版字典：`zh`、`en`；未知语言回退英文。
- 本地化：导航、状态、错误、菜单、Modal、Settings、Lightbox alt/label。
- 不翻译用户脑图标题、节点和补充要求。
- 桌面正式支持；窄屏可查看和基础编辑；不承诺手机完整触控编辑。
- 禁止 Windows 专属路径拼接与 shell 假设进入运行时代码。
- npm 发布包必须带 `lib/`，终端用户不需要本地构建。
- macOS 正式支持条件：macOS CI 通过且至少一次 DSH 实机 smoke test 留存证据。

## 15. 能力降级

| 缺失能力 | 降级行为 |
|---|---|
| subagents | 保留查看、编辑、本地文本创建；禁用语义生成 |
| fork provider | 有 supplemental context 时使用 spawn；否则禁用该次生成 |
| jobs/tool-jobs | 聊天 launcher 返回明确不可用；面板仍可 direct run |
| settings | 使用编译默认值；不展示插件设置卡 |
| tool view slot | 聊天显示文本结果；脑图页不受影响 |
| rc8 无公开 ImageLightbox | SVG 缩略图仍显示；点击打开插件自有可访问预览 dialog |

能力检测发生在公开 service/provider/slot 层，不通过导入私有源码或版本号猜测。

## 16. 错误码

至少定义：

- `CAPABILITY_UNAVAILABLE`
- `SESSION_UNAVAILABLE`
- `WORKSPACE_SCOPE_MISMATCH`
- `MINDMAP_NOT_FOUND`
- `MINDMAP_BUSY`
- `MINDMAP_CONFLICT`
- `MINDMAP_REVISION_EXPIRED`
- `SOURCE_UNAVAILABLE`
- `GENERATION_TIMEOUT`
- `GENERATION_FAILED`
- `INVALID_AGENT_OUTLINE`
- `INVALID_REQUEST`
- `STORAGE_FAILED`

Host 日志记录完整错误链；UI 和 model-facing output 只接收稳定 code 与安全摘要。

## 17. 测试计划

### 17.1 Unit

- workspace cwd normalization/hash：Windows、macOS、Linux 样例。
- V1→V2 lazy migration 与 deterministic legacy revision。
- generation preview 两代旋转。
- manual autosave 不旋转 previous/preview。
- restore previous 原子交换且不改变 preview revision。
- 第三次生成后第一代 revision 返回 expired。
- generation lock 同 map 冲突、不同 map 并行、失败释放。
- generation commit 的 compare-and-swap；生成期间手动编辑不得被后台结果覆盖。
- 新建生成失败后不得残留空 record；成功后只出现一个完整 V2 record。
- 180 秒 timeout、cancel、dispose 恰好一次。
- provider 选择 fork→spawn→unavailable。
- strict outline validation 和节点限制。
- API error code 映射，不泄漏内部异常。

### 17.2 Host integration

- fake `SubagentRuntime` 返回 structured output，验证保存后才完成 Job。
- chat Job output 含 presentation tool 所需引用。
- panel direct run 完成后不触发父 Agent 消息。
- owned Job 完成通知路径由官方 tool-jobs 接管。
- session/cwd workspace scope 拒绝跨 workspace 读取与写入。
- service 缺失时插件仍可 mount，capabilities 与 UI 正确降级。
- plugin dispose 会取消并 await 所有 panel runs。

### 17.3 Client

- session/workspace 范围切换。
- 只有一个主要重新生成按钮。
- 生成中禁用同 map 再次生成。
- completed 刷新 record；failed 保留旧 current。
- restore 菜单只在有 previous 时出现。
- 设置修改不改变已有 map。
- Tool card 的 loading/ready/expired/failed。
- 点击 SVG 打开插件自有可访问预览 dialog，Escape 关闭并恢复焦点。
- 中英字典无缺键；未知 locale 回退英文。
- 窄屏无横向页面溢出。

### 17.4 E2E / smoke

1. 在聊天中要求基于已有对话生成脑图。
2. 确认主聊天可继续输入，后台 Job 可见。
3. 完成后父 Agent 收集 job output 并追加 SVG 卡。
4. 点击 SVG 放大；关闭后焦点恢复。
5. 在脑图页重新生成；确认主聊天没有新增消息。
6. 生成期间重复点击被阻止。
7. 手动编辑并刷新，编辑仍在且 previous 不变。
8. 恢复上一版本，再次恢复可切回。
9. 连续生成三次，第一代聊天卡显示“本图已失效”。
10. 删除脑图，所有关联卡显示失效。
11. 切换 workspace，不显示其他 workspace 脑图。
12. Windows 与 macOS 各执行一次完整路径。

## 18. 性能与可靠性验收指标

- launcher tool 接受并返回 Job id：目标 P95 < 250 ms，不含模型调度。
- panel 点击后显示 running：目标 < 300 ms。
- 后台硬超时：180 秒 ± 2 秒。
- 同 map 并发生成：100% 被拒绝或复用已有 run，不出现双写。
- completed 状态出现时，新 record 已可读取。
- 任意失败、超时、取消后旧 `current` 不变。
- 插件重载后不存在悬挂 run、未释放 lock 或未 revoke Blob URL。
- 默认 360 节点脑图的 SVG preview 与画布各自在普通桌面环境 1 秒内可用；120 节点作为较小配置档。
- 浏览器初始进入对话页时不得执行 XMind export。

## 19. Gate 0：必须先验证的技术假设

实施 Agent 在大规模重构前必须提交一个小型验证 PR，证明：

1. 目标 DSH 组合中 `fork` provider 名称确为 `fork`，且支持 outputSchema/toolFilter/persona。
2. fork 不包含当前未完成回合；`supplementalContext` 能覆盖当前附件/正文场景。
3. owned Job 完成后父 Agent 能稳定收到通知、调用 `job_output`，并按指令调用展示工具。
4. `tool.call.toolview` 自定义 renderer 在 live、reload、call head 被裁剪三种情况下都能读到持久引用。
5. SimpleMindMap `export('svg')` 返回可供 `<img>` 与插件自有预览 dialog 使用的 `image/svg+xml` Blob/data URL。
6. 缺失 jobs/subagents/settings 时 optional `ctx.inject`/`ctx.get` 降级不会阻止插件 mount。

rc8 适配结论：官方 `ImageLightbox` 不在公开导出面，因此第 5 项由自有可访问 SVG 预览 dialog 实现；不读取 DSH 私有编译路径。

任何一项失败，先更新本文 ADR 与接口设计，再进入 Phase 1；禁止用临时私有 API 绕过。

## 20. 实施阶段与 Agent 任务包

### Phase 0 — 技术验证

当前 Gate 0 状态（2026-08-19）：本地契约、runtime fixture、包验证和已有 live transcript 已通过；G0-4-live、G0-5-live、G0-6-live 仍为 `PENDING_LIVE`，因为需要外层 GUI 的 call-head 裁剪、浏览器 dialog 交互和完整 profile 缺失能力证据。按当前实施目标，这三项不阻止 rc8 实现交付；完整结果和证据强度见 `docs/PHASE_0_GATE_0_EVIDENCE.md`，可用 `npm run verify:gate0` 重复。`G0-5-live` 验证插件自有 dialog，不声称官方 ImageLightbox。


负责人拥有：验证 fixture、最小测试、ADR 更新；不重构产品 UI。

交付：

- Gate 0 六项结果表。
- 可重复命令或测试。
- 对失败假设的修订建议。

验收门：全部通过，或技术设计已更新并得到确认。

### Phase 1 — Domain、Storage、Settings

建议修改：

- `src/domain/*`
- `src/core.ts`
- `src/library.ts`
- Host settings 注册
- Core/Library tests

交付：

- V2 record、lazy migration、workspaceKey。
- preview 两代旋转和 restore API primitive。
- strict outline builder。
- settings namespace。

不得修改：聊天工具卡和主 UI。

验收门：全部 unit tests、旧 fixture 读取、原子写入与类型检查通过。

### Phase 2 — Generation Orchestration

建议修改：

- `src/host/generation-*`
- `src/host/panel-runs.ts`
- fake subagent/jobs integration tests

本阶段交付约束（S2 设计增量评审，见 `docs/plans/S2_DESIGN_DELTA_REVIEW.md`）：

- 不得修改 `src/index.ts` 与 `inject` 装配；chat/panel adapter 以工厂函数或纯装配模块＋fake 驱动测试交付，由集成阶段统一接线。
- 现存 `startPanelRegeneration` 旧路径冻结：禁止增强；prompt 逻辑以 `src/host/generation-executor.ts` 导出实现为唯一规范副本，集成期一次性切换并删除旧副本。

交付：

- GenerationExecutor。
- provider 选择、persona、schema、tool filter。
- 180 秒 timeout、dispose、锁。
- chat/panel adapters，panel 无聊天副作用证明。

不得修改：视觉 UI。

验收门：并发、timeout、cancel、plugin dispose 与失败不覆盖 current 全部测试通过。

### Phase 3 — Tools、Routes、Chat Card

建议修改：

- `src/host/tools.ts`
- `src/host/routes.ts`
- `src/client/components/MindmapToolCard.tsx`
- `src/client/preview/*`

交付：

- 异步 launcher tool。
- present tool 与 replay-safe 引用。
- REST V2 routes。
- SVG card、自有可访问预览 dialog、expired 状态。

验收门：聊天 E2E、reload replay、第三代失效、删除失效通过。

### Phase 4 — Brainmap UI 与 Settings UI

建议修改：

- `src/client/components/*`
- `src/client/api.ts`
- `src/client/locale.ts`
- `src/client/styles.css`

交付：

- session-first/workspace-second 信息架构。
- appearance 与 overflow 收纳。
- regenerate Modal、状态、Toast、restore previous。
- settings.plugin.item 卡。
- 官方 primitives、DSW tokens、中英双语、窄屏布局。

验收门：client tests、键盘操作、窄屏、字典完整性通过；无 setDraft 重建路径。

### Phase 4.5 — 结构化导出与学习闭环（0.2.x 新增）

建议修改：

- `src/domain/mindmap-doc.ts`
- `src/host/export/*`
- `src/client/export/*`
- `tests/export/*`

吸收参考项目 `chenw2759-wq/dsh-mindmap` 的可取能力：

- 将脑图先规范化为可校验的 `MindmapDoc`（分支、分组、条目、子条目、来源）；
- A3 横向打印 HTML，每个主干分页，封面/目录、右侧笔记区和可解释的溢出报告；
- classic / minimal / creative / academic 风格预设；
- 可选题目页（选择、判断、填空、简答），题目绑定知识点、答案、解析和易错点；
- `mindmap-builder` 方法 skill，固化“来源提取 → 知识组织 → 渲染 → 溢出修正”的工作流。

强制安全与产品边界：

- 导出器必须 HTML-escape 文本和属性；禁止把 Agent 输出直接拼进 `innerHTML`；
- 生成 HTML 必须自包含，不依赖 dsh-IDE、CDN 或外部网络；dsh-IDE 只能作为可选预览器；
- 题目必须 schema 校验、答案一致性校验并保留节点来源，导出前先预览；
- 性能验收覆盖至少 100 个主干、每主干 50 个条目，并分别记录预算估算和真实打印渲染结果。

验收门：fixture golden HTML、HTML sanitizer/security tests、quiz schema tests、A3 print smoke 和浏览器截图证据通过。

### Phase 5 — Packaging、Compatibility、Release QA

交付：

- package peer/dev dependencies 与 DSH inject 更新。
- README 使用流程、最低版本、能力降级和 macOS 状态。
- Windows/macOS CI。
- npm pack/verify、bundle 体积报告、完整 smoke evidence。

验收门：本文第 17、18、22 节全部满足。

## 21. 多 Agent 协作规则

- Phase 0 必须串行先完成。
- Phase 1 与 Phase 2 不并行修改 `library.ts`；Phase 2 只消费 Phase 1 的稳定接口。
- Phase 3 与 Phase 4 可在 Phase 2 后并行，但分别拥有 chat preview 与 brainmap page 文件。
- `src/client/index.ts`、`src/index.ts`、`package.json` 由最后集成 Agent 统一修改，避免冲突。
- 每个 Agent 提交时必须列出：修改文件、行为变化、测试命令、未验证边界。
- 不得顺手格式化无关文件，不得覆盖现有未提交修改。
- 任何偏离本文约束的实现必须先写 ADR，不得只在代码注释里决定。

每个 Agent 开工前复制对应 Phase 作为任务说明，并附上：

```text
基线 commit/worktree：
负责的 Phase 与文件：
明确不修改的文件：
依赖的前置接口：
本 Phase 验收门：
```

每个 Agent 完工时提交统一 handoff：

```text
完成的约束/验收项：
修改文件：
新增或变更的公开接口：
执行过的命令与结果：
人工验证证据（截图/日志路径）：
未验证、风险或 ADR 偏差：
建议下一 Phase 使用的 commit：
```

集成 Agent 只负责装配、冲突消解和全量回归，不得在集成阶段静默重写 Phase 0 的技术结论。

## 22. 最终验收清单

### 工作流

- [ ] 聊天生成不阻塞主会话。
- [ ] 父 Agent通过官方 Job 完成通知收集结果。
- [ ] 最终聊天 SVG 是独立的展示工具卡。
- [ ] 面板生成不写入聊天。
- [ ] 180 秒 timeout 生效。
- [ ] 同 map 不发生并发覆盖。
- [ ] 生成期间发生手动编辑时，后台结果因 revision conflict 被拒绝而非覆盖编辑。

### 数据

- [ ] V1 数据可读，V2 原子写入。
- [ ] 手动编辑不旋转 previous/preview。
- [ ] 重新生成正确旋转两组版本。
- [ ] restore 可往返切换 current/previous。
- [ ] workspace 隔离成立。
- [ ] 不持久化原始来源正文。

### 聊天预览

- [ ] SVG 不随手动编辑变化。
- [ ] 只保留两代 revision。
- [ ] 超代或删除显示“本图已失效”。
- [x] 点击使用插件自有可访问 SVG 预览 dialog；官方 ImageLightbox 不作为 rc8 公开 API 依赖。
- [ ] 无“打开脑图”按钮。

### UI

- [ ] 默认当前 session，二级当前 workspace。
- [ ] 常驻按钮数量符合本文设计。
- [ ] 低频操作进入菜单/Modal/Settings。
- [ ] 使用官方 primitives 与 tokens。
- [ ] 中英双语、窄屏可用。
- [ ] 初始 mount 不生成 XMind。

### 稳定性与兼容

- [ ] 缺失官方能力时可预测降级。
- [ ] plugin unload 清理 runs、locks、timers、Blob URLs。
- [ ] Windows CI 通过。
- [ ] macOS CI 通过；正式宣传支持前有实机 smoke 证据。
- [ ] `npm test`、`npm run typecheck`、build、pack verify 全部通过。

## 23. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| DSH `0.1.0-rc` API 变化 | 编译或运行失效 | 只用公开 exports；能力检测；CI 锁定最低与当前版本 |
| 父 Agent 未按 Job output 调用展示工具 | 无最终 SVG 卡 | Gate 0 验证；精简明确 output；必要时再评估官方 durable notice 扩展 |
| 当前回合附件不在 fork seed | 来源缺失 | supplementalContext；失败显式化；不静默生成 |
| SimpleMindMap SVG export 性能 | 聊天卡迟缓 | 按需生成、LRU、节点上限、独立失败 fallback |
| V2 记录体积增加 | 磁盘占用 | 只保留两代 JSON 快照，不落盘 SVG/原文 |
| panel direct run 与 Jobs 行为分叉 | 生命周期 bug | 共用 GenerationExecutor；adapter contract tests |
| workspace 路径差异 | 错误隔离 | 平台明确 normalization test；不使用 realpath |

## 24. ADR 摘要

- ADR-001：生成核心保持确定性；subagent 只是上游 outline transformer。
- ADR-002：聊天用 owned Jobs，面板用 direct one-shot run，以满足不同通知语义。
- ADR-003：最终聊天结果追加新工具卡，不动态改写启动 call。
- ADR-004：聊天预览按 generation revision，不按 editable current。
- ADR-005：只保留两代预览文档，SVG 浏览器按需生成且不落盘。
- ADR-006：workspace scope 使用 session cwd 的规范化 hash。
- ADR-007：官方能力缺失时禁用相关功能，不维护旧 setDraft 工作流。
- ADR-008：`maxTokens=6000` 为编译期稳定性策略常量；Gate 0 样本校准证据延后至 live verification runbook，缺失不阻塞编排层实施。

## 25. Definition of Done

只有同时满足以下条件才可宣布完成：

1. 第 22 节每一项均有测试、截图、日志或人工步骤证据。
2. 第 17 节所有自动测试通过，第 18 节指标达到或有获批偏差记录。
3. README、package metadata、peer dependencies 与实际行为一致。
4. 没有遗留 `setDraft` 重新生成、eager XMind export、硬编码中文主流程或自制 Lightbox。
5. 独立验收 Agent从干净安装执行聊天、面板、版本恢复、失效预览和跨 workspace 全路径。
6. 未验证的 macOS 状态不得在文案中写成正式支持。
