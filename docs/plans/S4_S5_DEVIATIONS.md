# S4/S4.5/S5 偏差决策记录

按各阶段 v3 计划偏差协议维护；每条含：偏差/原因/备选对比/结论。条目随所属任务提交一并更新。

## D-S4-1（W1）：panel adapter 增加加法式 begin/settle 分解

- **偏差**：`src/host/adapters.ts`（S2 冻结面）新增 `begin()`/`settle()` 方法，`start()` 语义保持不变；index.ts 的 `startPanelRun` 改用 `begin()`。
- **原因**：§11 要求 `POST /maps/:id/regenerate` **立即返回 runId** 供客户端轮询与取消。直接接线 `adapter.start()` 会让 HTTP 响应阻塞到生成完全结算（W1 实测三方死锁：测试等响应、响应等生成、生成等喂结果），客户端在拿到 runId 前无法轮询也无法取消，违背 §11 表格契约。
- **备选对比**：(a) 改 `start()` 返回形状——host.test.mjs 多处黄金断言（await start 后断言终态）全部破坏，S2 面重写；(b) routes.ts 增加 fire-and-forget 分支——触碰 S3 冻结路由文件且改变其已锁定行为；(c) 加法式分解：`begin()` 同步注册视图并返回 `{view, done}`，`start()` 变为 `begin(input).done` 薄包装（采纳）。
- **结论**：采纳 (c)。S2 黄金断言零触碰（start 行为逐字节等价）、routes.ts 零改动；新契约由 index suite 断言锁定（202 accepted → 轮询 completed）。代价：adapters.ts 导出面扩大一个方法。

## D-S4-2（W1）：F-1 核销反转 host.test.mjs 黄金断言

- **事实**：host.test.mjs 原 73–77 行注释与断言「备注全超预算时提示文本**不含**『未附带』」——锁定的正是 F-1 登记的缺陷行为，注释亦明言“忠实复刻直至集成切换修复”。
- **处置**：随 F-1 修复同步反转为「含『未附带』且含『全部因超出提示预算』」。属移交清单预期内的断言改写（D-S3-8 同族），非契约放宽。

<!-- D-S4-N / D-S45-N / D-S5-N 按序追加 -->
