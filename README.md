# openclaw-kimi-code-harness

让 Moonshot AI 官方 **Kimi Code Agent Runtime** 执行 OpenClaw 主助手回合。本包注册的是 `AgentHarnessV2`，不是模型 Provider、ACP 子 Agent，也不会通过 PTY、终端文本解析或模拟按键驱动 CLI。

## 工作方式

- OpenClaw：消息渠道、定时任务、长期记忆、路由、可见 transcript、审批 UI 和外层助手生命周期。
- Kimi Code：原生 Agent Loop、模型调用、编程工具、Shell、文件修改、原生会话、权限规则和上下文管理。
- 本插件：只接管显式配置为 `agentRuntime.id: "kimi-code"` 的兼容 `kimi` 路由。

详细边界见 [架构说明](docs/ARCHITECTURE.md)，限制见 [已知限制](docs/KNOWN_LIMITATIONS.md)。

## 环境要求

- OpenClaw `2026.11.3` 或兼容更新版本。Agent Harness 插件 API 仍是实验接口，升级宿主后应重新运行测试。
- Node.js `>=24.16 <25` 或 `>=26.1`。
- 官方 Kimi Code 登录状态或官方 `config.toml` 中可用的原生模型认证。

运行时不需要另开一个 Kimi CLI 进程。本包携带从官方公开源码固定提交构建的 Node SDK 运行产物，因此未安装 `kimi` 命令不会导致运行失败；但首次交互登录通常仍应使用官方 CLI。

## 安装

### 从源码构建并安装

```bash
git clone <this-repository> openclaw-kimi-code-harness
cd openclaw-kimi-code-harness
npm install
npm run build
npm pack
openclaw plugins install npm-pack:/absolute/path/to/openclaw-kimi-code-harness-0.1.0.tgz --force --accept-capabilities
```

`--accept-capabilities` 是外部 Agent Runtime 的显式能力授权；只应在你已审计并信任本包时使用。

如果本目录已经是构建完成的本地插件，也可以：

```bash
openclaw plugins install /absolute/path/to/openclaw-kimi-code-harness
```

检查加载结果：

```bash
openclaw plugins inspect kimi-code-harness --runtime --json
```

### Kimi Code SDK 供应说明

调研时官方新包的名称是 `@moonshot-ai/kimi-code-sdk`，但 npm 尚未公开发布，不能写成普通 npm 依赖并假装可安装。本包的 `vendor/kimi-code-sdk.mjs` 来自官方仓库 `MoonshotAI/kimi-code` 的公开 `packages/node-sdk` 入口，固定源码提交记录在 `vendor/PROVENANCE.json`。

如需更新或重建该产物：

```bash
npm run sdk:vendor
```

该命令会用 `vendor` 脚本中固定的提交克隆/校验官方源码，运行官方 SDK build，再用 esbuild 合并其公开入口的运行闭包。已有官方源码 checkout 时可设置：

```bash
KIMI_CODE_SOURCE_DIR=/absolute/path/to/kimi-code npm run sdk:vendor
```

生产环境也可通过 `sdkModule` 指定一个已经构建、且公开导出 `createKimiHarness` 的兼容 SDK 模块。插件不深链 Kimi Code 私有内部包。

## 认证

优先复用官方 CLI 的登录状态：

```bash
npm install -g @moonshot-ai/kimi-code
kimi login
kimi doctor
```

插件把认证引导声明为 Harness 所有，通过官方 SDK 使用 `~/.kimi-code`（或官方 `KIMI_CODE_HOME` 解析结果）的配置和 OAuth 状态。插件不读取、复制或记录旧社区插件的私有凭据文件，也不把 OpenClaw API Key 填进 Kimi Code。

官方 SDK 原生配置中的其他可用认证方式可继续使用；本插件不会为它们逆向额外登录流程。OpenClaw 自动发现的 direct 凭据不会转发给 Kimi Code，执行仍只使用官方原生认证。若用户显式绑定了 OpenClaw auth profile，`supports` 会拒绝该路由，而不是暗中替换用户指定的认证来源。

## 配置

安装并启用插件后，使用目标配置：

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "kimi/kimi-for-coding"
      },
      "models": {
        "kimi/kimi-for-coding": {
          "agentRuntime": {
            "id": "kimi-code"
          }
        }
      }
    }
  }
}
```

`kimi/kimi-for-coding` 的模型目录和 Provider 仍由 OpenClaw 官方 `kimi` 插件提供；本包不重复注册 Provider。

可选插件配置：

```json
{
  "plugins": {
    "entries": {
      "kimi-code-harness": {
        "config": {
          "approvalPolicy": "openclaw",
          "approvalTimeoutMs": 120000
        }
      }
    }
  }
}
```

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `approvalPolicy` | `openclaw` | `openclaw` 使用宿主审批；`deny` 对所有原生审批请求安全拒绝 |
| `approvalTimeoutMs` | `120000` | 审批和交互等待上限 |
| `homeDir` | 未设置 | 覆盖官方 Kimi Code home 目录 |
| `configPath` | 未设置 | 覆盖官方 `config.toml` 路径 |
| `sdkModule` | 未设置 | 覆盖兼容 SDK 的包名、`file:` URL 或绝对模块路径 |

权限模式固定为 Kimi Code 原生 `manual`。插件不会默认启用 `yolo`/`auto`，不会伪造审批成功。OpenClaw 无可用审批路由、审批超时或桥接异常都会拒绝操作。

## 会话与工作区

- OpenClaw Agent ID + 会话键经哈希后映射到 Kimi Code 原生 session ID，并存储在 OpenClaw 插件状态中。
- 同一 OpenClaw 会话的多轮回合复用原生会话；插件/Gateway 重启后从持久映射恢复。
- 工作区只使用 OpenClaw 准备好的绝对 `cwd`/`workspaceDir`，经 `realpath` 校验；绝不回退到插件进程的 `cwd`，也不复制项目。
- 物理会话 ID、Agent、工作区或模型不一致会失败，不会串会话。
- `/new`、reset 和 context reset 会解除映射；删除只有在 OpenClaw 提交删除后才删除原生会话。

## 故障排查

### `Kimi Code SDK is unavailable` / 缺少 `createKimiHarness`

确认发布包中存在 `vendor/kimi-code-sdk.mjs`，或把 `sdkModule` 指向兼容构建。重新安装/更新插件；不要安装旧的 `@moonshot-ai/kimi-agent-sdk` 来替代新 SDK。旧包依赖当前 CLI 已移除的 `--wire` 接口，与本插件不兼容。

### `authentication is missing or expired` / 401

运行 `kimi login`，再运行 `kimi doctor`。如果使用了自定义 home/config，确保 Gateway 与登录命令使用同一组官方路径。

### `native config has no model matching`

检查 `~/.kimi-code/config.toml` 的 `default_model` 和模型 alias。插件只选择与 OpenClaw 模型 ID 匹配的原生模型，不会在失败时悄悄换模型。

### `binding workspace or model changed`

这是防串会话保护。重置该 OpenClaw 会话，或恢复原工作区/模型后重试。

### `native session no longer exists`

原生会话已被删除或损坏。插件会删除失效映射；重置 OpenClaw 会话后创建新原生会话。不要从别的会话复制 native ID。

### 沙箱或工具策略被拒绝

MVP 是 `host-only`，Kimi Code 独占原生编程工具。OpenClaw 动态可执行工具不会同时注入，受限工具策略、沙箱必需回合和回合中 steering 不会被静默降级。

### 调试

启用 OpenClaw 的 `agents/harness` 调试日志，检查结构化 `agent harness selected` 记录是否确实为 `kimi-code`。插件自己的错误和审批日志会脱敏，但 Kimi Code 官方运行日志仍由官方 SDK 管理，应遵循其日志保留策略。

## 测试

```bash
npm run typecheck
npm run build
npm test
```

真实测试默认跳过，只有显式设置环境变量才运行：

```bash
KIMI_CODE_REAL_SMOKE=1 npm run test:smoke
```

真实测试会在 `.smoke-tmp` 下创建临时项目，要求 Kimi Code 修改文件并运行测试，随后检查流式输出、同会话恢复、取消和安全拒绝。它会调用真实模型并可能产生用量。模拟测试不会替代真实测试报告；实际执行记录见 [验证记录](docs/VERIFICATION.md)。

## License

MIT。官方 Kimi Code SDK 源码及捆绑依赖的相应权利归各原作者；Kimi Code 许可证见 `vendor/KIMI_CODE_LICENSE`。
