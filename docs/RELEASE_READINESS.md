# Release Readiness Report — dsh-chat-mindmap

> 生成时间：S5 阶段末。**发布动作（npm publish / git tag / version bump）尚未执行，等待人工确认。**

## 门禁矩阵（全绿 ✅）

| 门禁 | 状态 |
|---|---|
| npm test（16 组套件） | ✅ exit 0 |
| typecheck | ✅ exit 0 |
| build | ✅ exit 0 |
| verify:gate0 | ✅ exit 0 |
| verify:sast | ✅ exit 0 |
| verify:package | ✅ exit 0 |
| verify:bundle | ✅ exit 0 |
| check-tokens | ✅ exit 0 |

## 打包体积

npm pack tarball：252.8 KB（含 lib/ 编译产物＋README＋LICENSE）。
终端用户免本地构建。

## 集成审计（W0 白名单核对）

- `src/index.ts`：装配面（164 行，原 585），仅引用 Phase 2/3 冻结模块 ✓
- `src/client/index.ts`：slot 装配（30 行，原 530），视图移入 components/ ✓
- `package.json`：test 链插链＋devDeps 三条目 ✓；peerDependencies 未动 ✓
- F-1 核销 ✓；D-S3-9 主题表单源收敛 ✓；D-S3-8 dispose 归零 ✓

## §22 最终验收清单

### 工作流（全部自动化验证 ✓）
- [x] 聊天生成不阻塞主会话（launcher 异步 job）
- [x] 父 Agent 通过 Job 完成通知收集结果
- [x] SVG 卡独立展示工具卡
- [x] 面板生成不写入聊天（probe emissionCount=0）
- [x] 180 秒 timeout 生效
- [x] 同 map 并发 MINDMAP_BUSY
- [x] revision conflict 拒绝而非覆盖

### 数据 ✓
- [x] V1 可读 V2 原子写
- [x] 手动编辑不旋转 previous/preview
- [x] regenerate 正确旋转两组版本
- [x] restore 原子交换
- [x] workspace 隔离
- [x] 不持久化原始来源正文

### 聊天预览 ✓
- [x] SVG 不随手动编辑变化
- [x] 两代 revision
- [x] 超代/删除显示失效
- [x] 自有可访问 dialog
- [x] 无"打开脑图"按钮

### UI ✓（live 视觉项标 PENDING_LIVE）
- [x] 默认 session，二级 workspace
- [x] 常驻按钮符合设计
- [x] 低频操作入菜单/Modal/Settings
- [x] token-only 样式
- [x] 双语字典零缺键
- [x] 初始 mount 不执行 XMind export

### 稳定性与兼容
- [x] 缺失官方能力可预测降级（§15 六行矩阵全绿）
- [x] plugin unload 清理 runs/locks/timers/Blob URLs
- [ ] Windows CI 通过 → **PENDING_LIVE**（workflow 已定义需 push 后首次触发）
- [ ] macOS CI ＋实机 smoke → **PENDING_LIVE**
- [x] npm test / typecheck / build / pack verify 全部通过

## ADR 索引

ADR-001~008 见 TECHNICAL_DESIGN §24。新增：D-S4-1 adapter begin/settle 加法分解；D-S4-3 WBS 编号映射；D-S4-4 长行管线教训。

## 遗留风险

R11/R12/R14 继承未触发。R19 大文档内存峰值已通过分页构建缓解（benchmark heapUsed 监控就绪）。

## 发布建议

1. bump version → 0.2.0
2. git tag v0.2.0 && push
3. npm publish --access public

**以上三步须由人工逐条确认后执行。本报告产出后实施 Agent 即停机。**
