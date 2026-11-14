# 已知限制（MVP）

1. **Agent Harness API 仍是实验接口。** 当前针对 OpenClaw `2026.11.3` 的公开/npm 接口，并参考上述 `main` 提交。宿主升级后必须重新测试。
2. **官方新 Node SDK 尚未公开 npm 发布。** 发布包依赖随包携带的官方固定源码构建产物；升级 SDK 需要显式重 build，不能假定 `npm install @moonshot-ai/kimi-code-sdk` 当前可用。
3. **只支持宿主机执行。** 注册为 `host-only`，不支持 OpenClaw sandbox-required、sandboxed、workspace-only 或远程工作区。它不是 sandbox。
4. **不注入 OpenClaw 动态可执行工具。** Kimi Code 独占文件、Shell、MCP 和编程工具。需要 OpenClaw 动态工具或逐条工具翻译的回合不支持。
5. **不支持所有工具策略。** 无法无损实施的显式限制会拒绝，不会保留原生工具绕过限制。
6. **不支持回合中 steering。** 已注册的 active-run 控制支持 Stop/abort；`queueMessage` 明确报不支持。新问题请等待当前回合结束。
7. **不实现 isolated completion、side question、settled-turn finalizer 或 OpenClaw 发起的 compact 回调。** Kimi Code 自己的自动上下文/压缩机制仍由原生 SDK 管理。
8. **模型 alias 必须能对应。** OpenClaw 的模型 ID 必须匹配 Kimi Code 原生 alias、其 `/` 后缀或底层模型名。多个匹配且默认模型不能消歧时失败。
9. **绑定变化需要 reset。** 工作区、模型或 OpenClaw 物理会话 ID 变化不会自动嫁接旧原生上下文。
10. **绑定有保留期。** 插件状态默认 TTL 为 180 天；过期后下一回合创建新原生会话，OpenClaw transcript 仍由宿主保留。
11. **reset 不删除旧原生历史。** 这是有意保留用户数据；只有 OpenClaw 已提交的会话删除才删除对应原生会话。
12. **SDK 官方日志由 Kimi Code 管理。** 本插件只保证自己的日志/错误转换脱敏，不声称重写官方引擎内部日志管线。
13. **真实模型测试具有非确定性。** 真实冒烟覆盖独立验证项；模拟通过不意味着不同模型版本、网络、配额或所有渠道 UI 都已验证。
