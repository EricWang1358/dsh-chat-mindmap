# S0（Phase 0 · Gate 0 技术验证）阶段报告

- 依据：`docs/plans/S0_S1_PLAN_v3.md` 任务 S0-T1
- 执行日期：2026-08-23
- 基线 → 收尾 commit：`fecb1f1` → 本报告提交

## 1. 结论

Phase 0 正式关闭。六项 Gate 0 假设的全部自动化契约、runtime fixture 与既有 live transcript 验证在本机独立复跑通过；三个浏览器/组合层 live 项维持设计文档允许的 `PENDING_LIVE` 状态（设计文档 Phase 0 节已声明其不阻止后续实施）。本阶段零代码变更，仅落盘验证证据。

## 2. 复现命令与结果表

```text
npm run verify:gate0    # 退出码 0
npm test                # core/library/HTTP 全 passed
npm run typecheck       # 退出码 0
npm run build           # host+client 产物与 tgz 构建成功
```

| 检查项 | 结果 | 备注 |
|---|---|---|
| G0-1 fork provider 名称与能力 | PASS | public-contract |
| G0-2 fork 只继承已完成回合 | PASS | source-contract+fixture |
| G0-3 / fixture / live owned Jobs 通信 | PASS / PASS / PASS | 含 `PHASE_0_G0_3_LIVE_TRANSCRIPT.md` |
| G0-4 / fixture tool-card replay | PASS / PASS | G0-4-live = PENDING_LIVE |
| G0-5 / fixture SVG export + 自有 dialog | PASS / PASS | G0-5-live = PENDING_LIVE |
| G0-6 runtime fixture 缺失 optional 能力可 mount | PASS | G0-6-live = PENDING_LIVE |
| npm test | PASS | 3 个测试文件 |
| typecheck / build | PASS / PASS | — |

PENDING_LIVE 集合＝{G0-4-live, G0-5-live, G0-6-live}，与 `docs/PHASE_0_GATE_0_EVIDENCE.md` 结果表逐项一致。

## 3. 变更清单

- 新增 `docs/plans/S0_S1_STAGE_REPORT_S0.md`（本文件）。无源码、无依赖、无脚本变更。

## 4. 证据边界与遗留风险

- `scripts/gate0.mjs` 硬编码本机 DSH checkout 路径（评审 m4），跨机器复现需相同安装位置或后续参数化改造。
- 三个 PENDING_LIVE 项需要真实 DSH Web GUI runbook（见 evidence 文档「Live verification runbook」）；在完成前不得对外声称完整 GUI E2E 覆盖。
- rc8 约束保持：插件使用自有可访问 SVG 预览 dialog，不依赖未公开导出的 `ImageLightbox`。

## 5. 给 S1 的移交建议

- 直接进入 S1-W1（domain/errors.ts）；W2 的 DEFAULT_CONFIG 单一事实源迁移会触碰 src/library.ts import 关系，注意 W7a 之前的中间态保持类型绿。
- 存储层任务（W7a/W7b）实施前重读 v3 WBS 表中键集超集断言与 CAS 优先级规则，二者是本轮红队新增的硬验收。
