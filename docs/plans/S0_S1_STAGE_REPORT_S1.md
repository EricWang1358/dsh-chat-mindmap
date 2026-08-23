# S1（Phase 1 · Domain、Storage、Settings）阶段报告

- 依据：`docs/plans/S0_S1_PLAN_v3.md` 任务 S1-W1 … S1-W9
- 执行日期：2026-08-23
- 区间：S0 收尾提交 `be4c2d2` → 本报告提交

## 1. 变更清单（按 WBS）

| WBS | 提交 | 内容 |
|---|---|---|
| S1-W1 | `6edc66e` | `src/domain/errors.ts`：13 个 §16 稳定错误码 + `DomainError`；`tests/domain.test.mjs`；package.json test 链追加（偏差 D1） |
| S1-W2 | `bcc61a1` | `src/domain/settings.ts`：MindmapSettings/normalize/resolveNewRecordConfig；`DEFAULT_CONFIG` 单一事实源迁入 domain，library 反向 re-export |
| S1-W3 | `f870e53` | workspaceKey：`normalizeWorkspaceCwd(cwd, platform)`（含 `\\?\`/UNC 前缀、分隔符、大小写策略）+ sha256 前 32 hex |
| — | `9137247` | DEV-1 偏差记录（相对 cwd 抛 INVALID_REQUEST 的规格补充） |
| S1-W4 | `21d0bdd` | V2 记录类型 + `migrateRecordToV2` lazy 迁移（幂等、纯函数、迁移代=第 1 代） |
| S1-W5 | `0403103` | `rotateGenerationSnapshots` / `applyManualEdit` / `swapCurrentPrevious` 纯原语 + 两代失效证明 |
| S1-W7a | `3a0aea8` | library 存储层 V2 写读贯通：落盘 schemaVersion/recordVersion/workspaceKey/preview 双快照；V1 fixture 读入迁移；summaries 缓存缺失对账（DEV-2，`70b7765`）；结构兼容断言 |
| S1-W7b | `4c06a97`+`2a4b85c` | `expectedRecordVersion` CAS（与 expectedUpdatedAt 并存时 CAS 优先）；手动编辑默认不旋转 previous/preview（显式 rotatePrevious:true 仍旋转）；`restorePreviousMindmap()` 原子交换出口（写队列串行、版本递增、可往返） |
| S1-W8 | `873bdf0` | verify-sast 清单纳入全部 src/domain/*.ts 与 revisions.ts，existsSync 容错保证任意前缀回滚可运行 |

## 2. 门禁结果（阶段末全量复跑）

```text
npm test                 # 11 个测试段全 passed
npm run typecheck        # 退出码 0
npm run build            # host/client/tgz 构建成功
npm run verify:sast      # passed（清单含 domain 模块）
npm run verify:package   # package verification passed
npm run verify:bundle    # 588457 B raw / 170729 B gzip（预算 204800 B）
npm run verify:gate0     # 退出码 0；PENDING_LIVE = 3（维持设计允许状态）
```

## 3. 验收标准达成对照（v3 §2）

- W1–W6 全部 Given/When/Then 断言存在于 tests/domain.test.mjs 且通过；W6 跳级样例按探针实测固化（X/Y 均保留为根子节点）。
- W7a：V1 fixture 经 getMindmap/listMindmaps 正确迁移可见；落盘 JSON 键集 ⊇ 规定的 V1∪V2 键集合；current/previous 过 validateMindmapDocument。
- W7b：CAS 冲突拒绝且磁盘不变；成功写 recordVersion 递增；双 token 并存时 CAS 决定胜负；手动编辑默认零旋转；restore 往返且 preview 引用不变；index.test.mjs HTTP 回归网未改动且持续绿。
- 提交历史逐一关联 WBS 编号（见上表 Refs 字段）。

## 4. R4 基线量测（响应/存储体积）

同一 360 节点文档序列化对比（node 内联脚本，本机实测）：

| 形态 | 字节 | 说明 |
|---|---|---|
| V1 记录 | 15,970 B | 无预览快照 |
| V2 记录 | 31,817 B | 含 previewCurrent（迁移代） |
| 比率 | **1.99×** | 第二次生成后接近 2.5~3×（双快照） |

GET /maps 直接返回完整 record，故 API 响应体积同比例增长；Phase 3 DTO 收敛时处理。

## 5. 偏差摘要

- D1（预先裁决）：package.json test 链追加。
- DEV-1：相对 cwd 输入显式抛 INVALID_REQUEST（设计未定义行为的防御性补充）。
- DEV-2：listMindmaps summaries 缓存缺失对账，修复「缓存当事实源」导致的记录不可见缺陷。

## 6. 遗留风险与移交建议

- R1 回滚窗口依旧成立：V2 写入后回滚旧二进制再写入会丢失预览快照字段；发布冻结期内禁止混跑。
- R3：workspaceKey 平台样例已锁定 win32/posix 行为；UNC 样例覆盖 `\\?\UNC\` 前缀剥离。
- R4：体积基线 1.99× 已量化；Phase 3 路由改造时应返回 DTO 或支持字段裁剪。
- 移交 Phase 2（Generation Orchestration）：直接消费 `src/domain/generation.ts` 的 strict outline builder、`src/domain/errors.ts` 的 coded error、library 的 expectedRecordVersion CAS 与 snapshotOf；Phase 2 只消费 Phase 1 接口，不再修改 library.ts 写路径语义（§21）。
- 未验证边界：真实 DSH Host 内的 settings 注册接线（N2，归集成阶段）；浏览器侧行为不受本阶段影响。
