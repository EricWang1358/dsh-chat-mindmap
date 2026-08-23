# S3 阶段报告

依据 `S3_PLAN_v3.md`；基线 b8d2e7c → 本阶段末端。测试链终序：core→library→domain→host→tools→routes→card→dialog→integration→index（index 恒末位）。

## 1. WBS × 提交

| 任务 | 提交 | 内容 |
| --- | --- | --- |
| W0 设计增量评审 | `b8d2e7c` | S3_DESIGN_DELTA_REVIEW 落盘；F-S3-1 mojibake 字节级修复（D-S3-2）；DEVIATIONS 骨架＋初始三条 |
| W1 launcher | `b243ff4` | host/tools.ts 异步 mindmap_generate_chat_mindmap（dsh-jobs 全异步、锁生命周期 finally 归还、CAS 复用）；id-patterns.ts 白名单共享源 |
| W2 present replay-safe | `7ebe2cd` ＋ `219e2d4` | 五键持久 payload、零写入面、workspace fence；新模块编译产物入库惯例（chore） |
| W3 REST V2 | `9f09c28` | routes.ts 规范路由器：错误信封、请求安全围栏、CAS 双通道（body/query）、revisions/restore/regenerate/panel-runs；library CAS 删除扩展、panel-runs 单跑取消 |
| W4 工具卡组件化 | `8fcc43a` | card-state.ts 纯态机、blob-url-lru.ts（R2-2）、MindmapToolCard.tsx＋registerSnapshotFetcher 注入（R1-4）；index.ts 内联卡片摘除 |
| W5 预览 dialog | `4038815` | preview/dialog.tsx：Esc/焦点恢复/closeRef 聚焦/cycleFocus 纯函数直测；负断言（单 onClose、无导航编辑面） |
| W6 集成语义 | `3c71eda` | integration.test.mjs 四组：三代失效/删除失效端到端（真实存储＋路由＋present＋卡片渲染）、reload+call-head 裁剪回放、dispose 归零（locks/panelRuns/LRU） |
| W7 sast＋报告 | 本提交 | verify-sast 七文件清单＋前缀 revert 实测；本报告 |

## 2. 门禁矩阵（每波次实测，均 exit 0）

| 波次 | npm test | typecheck | build | 附加 |
| --- | --- | --- | --- | --- |
| W1–W6 各自收口 | ✅ | ✅ | ✅ | — |
| 阶段末 | ✅（10 套件全绿） | ✅ | ✅ | verify:gate0 ✅ / verify:sast ✅ / verify:package ✅ / verify:bundle ✅（593,563 B raw / 171,964 B gzip，预算内） |

前缀 revert 实测（W7）：verify-sast 清单移出 tools.ts 与 MindmapToolCard.tsx 两例后仍绿，还原后再验绿——任意前缀回滚可运行该门禁。

## 3. §18 断言位置表

| 断言 | 位置 |
| --- | --- |
| 并发拒绝 | tests/tools.test.mjs（busy 用例，MINDMAP_BUSY） |
| completed ⇒ 可读 | tests/tools.test.mjs（launcher settle 后读）＋ routes GET /maps/:id/revisions/:rid（tests/routes.test.mjs） |
| revisionId sha256 确定性 | tests/tools.test.mjs（revisionIdOf 恒等断言） |
| 180s 恒等 | tests/tools.test.mjs（超时用例，短时限代理验证） |
| dispose 归零 | tests/integration.test.mjs（locks/panelRuns/LRU 三方 size===0 且 revoked===created） |
| <250ms 代理指标 | tests/tools.test.mjs（同步返回路径计时代理） |

## 4. 偏差摘要

- D-S3-1～D-S3-4：W0 过程与链插位裁决（详见 S3_DEVIATIONS.md）。
- D-S3-5/6：launcher 校验副本与 per-map config 覆盖语义。
- D-S3-7：git add -A 教训→全程显式路径 add。
- **D-S3-8（W6）**：panel-runs disposeAll 升级为清空式，S2 黄金断言按 R2-2 改写。
- **D-S3-9（W4）**：卡片主题表本地副本，Phase 4 收敛为单一真相源。

## 5. 遗留风险

- R11 absent baseline 竞态（继承，未触发）。
- R12 maxTokens 通道悬置（继承；chat prompt 不传 RC8_START_KEYS 之外键）。
- R13 legacy 兼容双实现并存＋黄金断言对照（Phase 4 切换时删除旧副本）。
- R14 renderToStaticMarkup 能力边界：effect 行为已纯函数化（cardStateOf/CardBody/cycleFocus），live DOM 行为归 runbook。
- R15 jsx 编译链变更随 W4 单提交验证 typecheck+build 双绿。

## 6. Phase 4 / 集成移交清单

1. index.ts 四处接线替换：generate 入参校验副本（D-S3-5）、REST 内联处理器→registerMindmapRoutes、present legacy 输出→tools.ts 规范面、client 卡片路径已切换（W4 完成，仅剩宿主侧）。
2. F-1：设计评审 F-1 项随切换一并核销（见 S3_DESIGN_DELTA_REVIEW）。
3. live runbook 三项：真机会话下 ①launcher 全链路（生成→settle→卡片缩略图→dialog 打开关闭）②panel regenerate 取消路径 ③插件卸载后 LRU/registry 归零与中断文案呈现。
