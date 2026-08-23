# S0/S1 设计合理性检查报告

- 审查对象：`docs/TECHNICAL_DESIGN_AND_IMPLEMENTATION_PLAN.md` Phase 0（Gate 0 技术验证）与 Phase 1（Domain、Storage、Settings）
- 基线 commit：`6401e88`（release: prepare legacy route compatibility 0.1.4）
- 基线门禁实测（2026-08-23）：`npm test` ✅、`npm run typecheck` ✅、`npm run build` ✅、`npm run verify:gate0` ✅（3 项 PENDING_LIVE 维持设计允许状态）、`npm run verify:sast` ✅、`npm run verify:package` ✅、`npm run verify:bundle` ✅（170729/204800 B gzip）
- 严重级别定义：blocker＝不修订即无法在不违背硬性约束的情况下进入 S1 实施；major＝会造成行为回归、安全隐患或验收门失败，必须在计划中处置；minor＝已知限制或改进项，登记即可。

## 1. 发现清单

### Blocker

| 编号 | 发现 | 证据 | 处置 |
|---|---|---|---|
| B1 | §6.1 要求「revisionId 使用随机 UUID 派生的 URL-safe id」，但现行实现是内容寻址 `rev-<sha256 前 24 hex>`，且路由白名单硬编码该格式。Phase 1 被 §21 禁止修改 `src/index.ts`；若按字面在 `previewCurrent.revisionId` 写入随机 id，现有 `GET /maps/:id/revisions/:revisionId` 与 `present_chat_mindmap` 会立即全部 410，直接违反 Phase 1 验收门「旧 fixture 读取通过」及第 2 节「聊天预览」约束 | 设计文档 199 行 vs `src/revisions.ts:9-12`、`src/index.ts:320-324`（正则 `/^rev-[a-f0-9]{24}$/`）、`src/index.ts:542-551` | **已修订设计文档 §6.1**：内容寻址确定性 id 为 V1/V2 通用规范实现（同时满足 §6.3 对 legacy 的确定性要求）；随机 id 仅允许在与路由白名单同步更新的变更中引入。详见本报告第 3 节 |

### Major

| 编号 | 发现 | 证据 | 处置 |
|---|---|---|---|
| M1 | `previewCurrent` 在接口中为必填，但「手动新建、从未 Agent 生成」的脑图没有语义合法的预览代次，设计未定义其初值；而现行 `present_chat_mindmap` 可以展示任何图的 current（含手动图），字面实施会造成行为回归 | 设计文档 172-181 行 vs `README.md:187`（新建粘贴 Markdown 流程）、`src/index.ts:420-426` | **已修订设计文档 §6.1**：记录创建时即以初始文档快照初始化 `previewCurrent`（创建视为第 0 代生成），`previewPrevious` 保持可选 |
| M2 | `updateMindmap` 在 `patch.document` 且未显式传 `rotatePrevious:false` 时默认旋转 previous，与第 2 节「用户手动编辑只更新 `current`，不得旋转 `previous`」矛盾；当前仅靠客户端调用方自觉传参维持约束 | 设计文档 35 行 vs `src/library.ts:338`、`tests/library.test.mjs:14` | S1 存储层将默认语义翻转为「手动文档更新永不旋转，仅生成提交显式旋转」，显式参数继续生效；列入计划 WBS 与回归测试 |
| M3 | 回滚安全性缺失：旧版二进制读取 V2 记录可行（`validateMindmapRecord` 显式重建对象、忽略未知字段），但旧版一旦再写入会丢弃全部 V2 新增字段（schemaVersion/recordVersion/workspaceKey/preview 快照）。升级后回滚存在数据退化路径，设计未声明 | `src/library.ts:220-240`、设计文档 165-201 行 | 计划风险登记册收录；增加结构兼容断言测试（V2 序列化必须保留全部 V1 必备字段且语义不变）；阶段报告向运维声明回滚窗口 |
| M4 | `verify-sast.mjs` 硬编码扫描文件清单，仅覆盖 4 个既有文件；S1 新增的 `src/domain/*` 全部逃逸静态安全扫描，属安全测试盲区 | `scripts/verify-sast.mjs:7` | 计划 WBS 纳入：新增 domain 文件必须同步加入 SAST 清单，作为任务验收标准之一 |
| M5 | `normalizeWorkspaceCwd` 规格未覆盖 Windows 长路径前缀 `\\?\` 与 UNC 路径；同一物理目录可能映射到两个 workspaceKey，破坏 §6.2 隔离模型的自洽性（失效模式为重复可见而非越权泄漏） | 设计文档 204-215 行 | S1 规范化函数补齐规则（剥离 `\\?\` 前缀、统一分隔符、盘符与路径大小写不敏感），Windows/macOS/Linux 样例进单测 |

### Minor

| 编号 | 发现 | 证据 | 处置 |
|---|---|---|---|
| m1 | `saveMindmap` 为三段独立原子写（map → index → summaries），进程崩溃窗口会遗留「文件存在但索引不可见」的孤儿记录；不会产生半份记录（每段自身原子），属可达性损失而非损坏 | `src/library.ts:307-315` | 登记为已知限制；恢复途径（重建 summaries/index 的既有逻辑）在设计中已隐含，不在 S1 扩scope |
| m2 | 本地 `npm test` 直接执行 `lib/*.js`，src 修改后若忘记重建会测到陈旧产物；CI 顺序正确（typecheck→compile→bundle→test） | `package.json:94`、`.github/workflows/ci.yml`（Test 步骤位于 Compile/Bundle 之后） | 开发纪律：每个 TDD 循环先 `npm run build` 再跑测试；写入计划测试策略 |
| m3 | §7 设置模型无 schema 版本与迁移定义；且 `ctx.settings.register()` 接线涉及 `apply()` 装配层（§21 归集成阶段统一修改 `src/index.ts`） | 设计文档 229-249 行、`src/index.ts` 整体 | S1 仅交付纯设置模块（类型、默认值、校验、新建合并策略），Host 注册接线列为非目标 |
| m4 | `gate0.mjs` 硬编码本机 DSH checkout 绝对路径，换机不可复现；属证据边界限制而非 Gate 结论缺陷 | `scripts/gate0.mjs:8` | S0 阶段报告中明示证据边界；修复留待后续工程化任务 |
| m5 | V2 记录携带两代预览快照，JSON 体积约增至 2~3 倍；现有预算（1000 张 / 100MB）仍充裕 | 设计文档 165-201 行 vs `src/library.ts:68-69` | 风险登记册收录；不做额外扩容 |
| m6 | 设计文档头部自述「历史设计基线 / 0.2.x 候选，不是 0.1.x 验收清单」，与本次实施指令的目标关系需要在计划书中显式声明（trunk 按 0.2.0-dev 演进；0.1.x 发布线冻结） | 设计文档 3-6 行 | 写入计划书目标/非目标章节 |

## 2. 非功能需求覆盖评估

- 安全：请求侧已有 loopback/origin/header 校验（`src/index.ts:278-296`）与 SAST 门禁；缺口为 M4（domain 逃逸扫描）。来源正文不落盘约束在存储层由现有结构维持，S1 新增字段均为元数据/文档快照，无正文通道。
- 性能：S1 触达面为纯 JSON 存储与纯函数，无热路径变化；m5 登记体积影响。画布性能条款（§13.4/18）属 Phase 4，不在本次范围。
- 可测试性：现有测试为构建产物驱动的裸 node 断言（无框架），TDD 循环可行但依赖 m2 纪律；workspaceKey/迁移/旋转均为纯函数，天然单测友好。
- 回滚：见 M3；另每任务单提交保证 `git revert` 粒度可用。

## 3. 设计文档修订记录（blocker 驱动）

依据工作流「存在 blocker 时先修订设计文档对应章节」，本次对 `docs/TECHNICAL_DESIGN_AND_IMPLEMENTATION_PLAN.md` 做两处最小修订（不动第 2 节产品约束）：

1. §6.1 规则第 4 条：`revisionId` 改为「内容寻址确定性 id（`revisionIdOf`，规范化 JSON 的 SHA-256 截断）为 V1 legacy 与 V2 快照的通用规范实现；随机 UUID 派生 id 仅可在同步更新路由白名单的变更中引入」——消除 B1。
2. §6.1 规则追加：「记录创建时即以初始文档快照初始化 `previewCurrent`（创建视为第 0 代生成）；`previewPrevious` 在第二次生成前不存在」——消除 M1。

修订后 B1/M1 复检：Phase 1 可在不触碰 `src/index.ts`、不回归现有 HTTP 行为的前提下交付全部 Phase 1 交付物。**结论：无剩余 blocker，进入 PLAN-AUTHOR。**

## 4. S0（Phase 0）现状判定

Gate 0 六项假设中三项 live 项（G0-4-live/G0-5-live/G0-6-live）为 `PENDING_LIVE`，设计文档 631 行已明确「按当前实施目标，这三项不阻止 rc8 实现交付」。自动化契约、runtime fixture、包验证与既有 live transcript 均可通过 `npm run verify:gate0` 与 `npm test` 重复验证（本报告基线门禁实测全绿）。因此 S0 的剩余工作为：独立复跑验证 + 证据一致性确认 + 阶段收尾报告，无需新增代码。
