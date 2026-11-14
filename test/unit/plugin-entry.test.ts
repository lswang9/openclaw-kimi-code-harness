import { describe, expect, it, vi } from "vitest";
import plugin from "../../src/index.js";
import { MemoryBindingStore } from "../helpers/attempt.js";

describe("plugin entry", () => {
  it("registers the official AgentHarness entry point as kimi-code", () => {
    const store = new MemoryBindingStore();
    const registerAgentHarness = vi.fn();
    plugin.register({
      registrationMode: "full",
      pluginConfig: {},
      logger: { warn: vi.fn() },
      runtime: {
        state: { openKeyedStore: () => store },
      },
      registerAgentHarness,
    } as never);
    expect(registerAgentHarness).toHaveBeenCalledOnce();
    expect(registerAgentHarness.mock.calls[0]?.[0]).toMatchObject({
      id: "kimi-code",
      authBootstrap: "harness",
      executionEnvironment: "host-only",
    });
  });

  it("does not register during base-only preparation", () => {
    const registerAgentHarness = vi.fn();
    plugin.register({ registrationMode: "base", registerAgentHarness } as never);
    expect(registerAgentHarness).not.toHaveBeenCalled();
  });
});
