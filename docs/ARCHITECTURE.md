# 架构说明

## 目标

`openclaw-kimi-code-harness` 是 OpenClaw 的低层 Agent Harness。宿主通过 `api.registerAgentHarness(...)` 注册 ID 为 `kimi-code` 的 `AgentHarnessV2`。只有模型级配置显式选择该 ID 时，`supports(ctx)` 才允许接管。

它不注册模型 Provider，不注册 ACP 子 Agent，不运行 Kimi Coding HTTP API 来代替 Agent Loop，也不使用 PTY 或终端文本解析。

## 回合调用链

```text
消息渠道 / cron / 控制界面
            │
            ▼
OpenClaw 路由、会话准入、工作区、宿主权限与回调
            │
            ▼
kimi-code supports(ctx) → runAttempt(params)
            │
            ├─ 读取/写入 OpenClaw 插件状态中的原生会话绑定
            ├─ createKimiHarness（官方 Node SDK 公开入口）
            ├─ createSession / resumeSession
            ├─ prompt(text + images + current-turn context)
            ├─ 原生 Agent Loop、模型、工具与上下文管理
            └─ turn.ended
            │
            ▼
OpenClaw AttemptResult + transcript/回复/外层生命周期
```

## 职责边界

| 能力 | 所有者 | 集成方式 |
| --- | --- | --- |
| 渠道接入、目标路由、回复传输 | OpenClaw | 保留宿主现有管线 |
| 主会话选择、reset/delete、持久 transcript | OpenClaw | Harness 实现对应生命周期钩子 |
| 定时任务和长期记忆 | OpenClaw | 当前输入作为回合上下文送入，不复制为第二套调度器 |
| 模型选择与外层路由策略 | OpenClaw | `supports` 检查实际 prepared route；Harness 不做隐式 fallback |
| 原生模型目录、alias 与官方认证 | Kimi Code | Harness 的 `loadModelCatalog` 发布原生模型；官方 SDK 管理配置、OAuth 状态和错误；direct 凭据不转发，显式 profile 不替换 |
| Agent Loop、推理、工具选择 | Kimi Code | SDK 原生 `Session.prompt` |
| 文件、Shell、测试和编程工具 | Kimi Code | 原生工具事件映射到 OpenClaw；不重复执行 |
| 原生会话历史、锁和自动 compaction | Kimi Code | SDK create/resume；OpenClaw 保存 ID 映射 |
| 审批 UI 与真人决定 | OpenClaw | SDK `setApprovalHandler` → host `requestApproval`/`waitForApproval` |
| 多选/自由文本提问 | OpenClaw 展示，Kimi Code 消费 | SDK `setQuestionHandler` → Gateway question bridge |
| 取消与超时 | 双方各自负责一层 | OpenClaw abort/timeout → SDK `Session.cancel`；Harness 等待并清理 |

## 工具所有权

MVP 不把 `params.tools` 转换为 Kimi Code 工具，也不调用 `createToolSurfaceAsync` 创建一套 OpenClaw 可执行工具。模型看到的文件、Shell 和编程能力全部由 Kimi Code 原生执行。

因此不存在“OpenClaw 执行一次、Kimi Code 又执行一次”的同调用双执行路径。OpenClaw 的渠道、记忆、调度和 transcript 仍在外层运行；它们不是注入给 Kimi Code 的同义 Shell/文件工具。

OpenClaw 的显式工具 allow/deny 限制不能自动翻译为 Kimi Code 原生权限规则时，Harness  fail closed。没有声明无法证明的 `conversationToolPolicySupport: "exact"`。

## 会话一致性

插件状态键包含 Agent ID 和 OpenClaw session key 的 SHA-256 哈希。记录还保存 OpenClaw 物理 session ID、工作区和原生模型。每次获取时检查这些字段，并用每个键的异步队列串行化。

- 正常多轮：复用活跃 SDK Session。
- 插件重载/Gateway 重启：读取插件状态并 `resumeSession`。
- 原生会话不存在：删除失效绑定并报可操作错误；不借用其他会话。
- reset：关闭当前 SDK Session、删除映射，但保留旧原生历史。
- 删除：先让 OpenClaw 事务提交，再删除映射和原生会话。

## SDK 供应与适配

官方当前源码中的 `@moonshot-ai/kimi-code-sdk` 包仍标记为 private，npm 查询为 404。插件自身只依赖公开入口形状：`createKimiHarness`、`Session.prompt/onEvent/cancel`、审批/问题 handler 和 create/resume/delete。

`src/kimi-sdk.ts` 是这个公开合约的结构化适配层。构建脚本从固定官方提交构建该公开入口并打包运行闭包；生产代码不 deep import `@moonshot-ai/agent-core-v2` 或其他私有包。

## 安全与错误

- 原生权限固定为 `manual`，默认审批桥接；可配置为全部拒绝。
- 不允许审批桥异常变成 allow。
- 工作区必须是已存在的绝对目录，不使用插件 cwd。
- 原生工具结果以保守副作用事实报告，失败/超时结果不被视为可安全重放。
- 日志和错误转换对常见 API Key、OAuth Token、Bearer 和 credential 字段脱敏。

## 源码依据

- OpenClaw `main`：`793c22c0ba9a3f69beb71b7c367cebfd0f196ed0`
- Kimi Code `main`：`f082f04a093a3e71a2263c5461d52507dc31f83a`
- npm 兼容验证：OpenClaw `2026.11.3`，Kimi Code CLI `2.6.2`
