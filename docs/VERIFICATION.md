# 验证记录

本文件只记录实际执行结果，不把跳过或模拟测试写成真实通过。

## 调研环境

- OpenClaw 官方 `main`：`793c22c0ba9a3f69beb71b7c367cebfd0f196ed0`
- Kimi Code 官方 `main`：`f082f04a093a3e71a2263c5461d52507dc31f83a`
- npm：OpenClaw `2026.11.3`；`@moonshot-ai/kimi-code` `2.6.2`；`@moonshot-ai/kimi-agent-sdk` `0.1.8`
- `@moonshot-ai/kimi-code-sdk`：npm 404；官方源码包仍 `private: true`
- 旧 agent SDK 使用 `kimi --wire`，当前 CLI 无此接口，因此未采用

## 已执行

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm test`：34/34 通过，11 个测试文件；包含 supports、原生模型目录、会话映射、流式事件、错误、取消/超时、脱敏、SDK 适配，以及两轮、重启恢复、双会话/双 Agent 隔离、reset 和删除。
- `KIMI_CODE_SOURCE_DIR=$PWD/.research/kimi-code npm run sdk:vendor`：通过；从固定官方源码构建并生成 `vendor/kimi-code-sdk.mjs`。
- 直接 `import()` 上述 vendor 产物：`createKimiHarness` 导出存在。
- 官方 CLI `node .../@moonshot-ai/kimi-code/dist/main.mjs --version`：`2.6.2`。
- 官方 CLI `doctor`：现有 `config.toml` 校验通过。

## 真实 Kimi Code 冒烟

命令：`KIMI_CODE_REAL_SMOKE=1 npm run test:smoke`

结果：1 个测试文件、2/2 测试通过，耗时约 38 秒。

- 在临时项目修改 `value.txt`，Kimi Code 原生执行 `node test.mjs`，测试独立复验通过。
- 收到真实流式 partial reply 和 Agent events。
- dispose 后重建 Harness，从同一持久映射恢复原 session ID。
- 外部 abort 映射为原生取消，最终 terminal 为 `aborted/external`。
- 通过真实 SDK 审批 handler 执行受控 `deny`，没有创建目标文件，并收到 denied 审批事件。

## OpenClaw 发布包与宿主端到端

- `npm pack`：通过；tarball 包含 `dist`、manifest、文档和 vendor SDK，压缩约 2.6 MB。
- 隔离安装命令：`openclaw plugins install npm-pack:<tarball> --force --accept-capabilities`。首次无授权旗标时被能力门拒绝；按提示增加旗标后安装成功。
- `openclaw plugins inspect kimi-code-harness --runtime --json`：`status=loaded`、`imported=true`、`agentHarnessIds=["kimi-code"]`，无 Provider 或工具重复注册。
- 真实命令：`openclaw agent --local --session-id kimi-code-harness-e2e ... --json`：返回 `OPENCLAW_KIMI_HARNESS_OK`，元数据含 `agentHarnessId=kimi-code`。
- 最终两轮宿主验证使用同一 `--session-id kimi-code-harness-e2e-v2`，在两个独立 CLI 进程中依次返回 `FIRST_OK`、`SECOND_OK`；两者 `agentHarnessId=kimi-code`，模型保持 `kimi-for-coding`，无 alias 路由切换提示。

### 宿主联调中实际修复的问题

1. 显式 Harness 路由需要原生 `loadModelCatalog`；已补充并通过模型准入。
2. SDK 二次 bundle 需要标准 Node `createRequire`；已修复并通过真实宿主加载。
3. active-run 注册必须携带宿主 `toolAuthorityFingerprint`；已补齐并通过真实回合。
4. AttemptResult 保留 OpenClaw 外层模型 ID，避免原生 alias 被误记为模型切换。
