import { describe, expect, it } from "vitest";
import { supportsKimiCodeRoute } from "../../src/support.js";
import type { AgentHarnessSupportContext } from "openclaw/plugin-sdk/agent-harness-runtime";

function context(overrides: Record<string, unknown> = {}): AgentHarnessSupportContext {
  return {
    provider: "kimi",
    modelId: "kimi-for-coding",
    requestedRuntime: "kimi-code",
    modelProvider: {
      requestTransportOverrides: "none",
      runtimePolicy: { compatibleIds: ["kimi-code"] },
      preparedAuth: { source: "harness" },
    },
    ...overrides,
  } as AgentHarnessSupportContext;
}

describe("supportsKimiCodeRoute", () => {
  it("accepts only an explicit compatible Kimi route", () => {
    expect(supportsKimiCodeRoute(context())).toEqual({ supported: true, priority: 100 });
  });

  it("allows automatically discovered direct credentials without using them", () => {
    expect(
      supportsKimiCodeRoute(
        context({ modelProvider: { preparedAuth: { source: "direct" } } }),
      ),
    ).toEqual({ supported: true, priority: 100 });
  });

  it.each([
    [{ requestedRuntime: "auto" }, "explicit-only"],
    [{ provider: "openai" }, "not a Kimi"],
    [{ modelId: "" }, "concrete"],
    [{ modelProvider: { requestTransportOverrides: "present" } }, "transport"],
    [{ modelProvider: { endpointOverrides: "present" } }, "endpoint"],
    [
      { modelProvider: { runtimePolicy: { compatibleIds: ["openclaw"] } } },
      "does not declare",
    ],
    [
      { modelProvider: { preparedAuth: { source: "profile" } } },
      "cannot be replaced",
    ],
  ])("rejects incompatible routes", (override, reason) => {
    const result = supportsKimiCodeRoute(context(override));
    expect(result.supported).toBe(false);
    expect(result.supported ? undefined : result.reason).toContain(reason);
  });
});
