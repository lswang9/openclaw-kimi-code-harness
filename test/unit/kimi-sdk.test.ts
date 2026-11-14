import { describe, expect, it } from "vitest";
import { loadKimiSdk, resolveNativeModel } from "../../src/kimi-sdk.js";
import { DEFAULT_PLUGIN_CONFIG } from "../../src/config.js";

const config = {
  defaultModel: "managed:kimi-code/kimi-for-coding",
  models: {
    "managed:kimi-code/kimi-for-coding": {
      provider: "managed:kimi-code",
      model: "kimi-for-coding",
      maxContextSize: 262_144,
    },
  },
};

describe("Kimi SDK adapter", () => {
  it("maps the OpenClaw model to the matching native alias", () => {
    expect(resolveNativeModel(config, "kimi-for-coding")).toBe(
      "managed:kimi-code/kimi-for-coding",
    );
  });

  it("fails instead of silently choosing another native model", () => {
    expect(() => resolveNativeModel(config, "other-model")).toThrow("no model matching");
    expect(() =>
      resolveNativeModel(
        {
          models: {
            "a/shared": { provider: "a", model: "shared", maxContextSize: 1 },
            "b/shared": { provider: "b", model: "shared", maxContextSize: 1 },
          },
        },
        "shared",
      ),
    ).toThrow("ambiguous");
  });

  it("rejects an incompatible explicit SDK module honestly", async () => {
    await expect(
      loadKimiSdk({ ...DEFAULT_PLUGIN_CONFIG, sdkModule: "node:path" }),
    ).rejects.toThrow("missing public createKimiHarness");
  });
});
