import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PLUGIN_CONFIG } from "../../src/config.js";
import { createKimiCodeAgentHarness } from "../../src/harness.js";
import { FakeKimiBackend } from "../helpers/fake-kimi.js";
import { makeAttempt, MemoryBindingStore } from "../helpers/attempt.js";

describe("attempt cancellation and timeout", () => {
  it("cancels the native session on external abort", async () => {
    const backend = new FakeKimiBackend();
    const harness = createKimiCodeAgentHarness({
      config: DEFAULT_PLUGIN_CONFIG,
      sessionStore: new MemoryBindingStore(),
      sdkLoader: async () => backend.module(),
    });
    const abort = new AbortController();
    const params = await makeAttempt({
      prompt: "LONG",
      abortSignal: abort.signal,
      onPartialReply: vi.fn(() => abort.abort()),
    });
    const result = await harness.runAttempt(params);
    expect(result).toMatchObject({ terminal: { kind: "aborted", source: "external" } });
    expect([...backend.records.values()][0]?.cancelCount).toBe(1);
    await harness.dispose();
  });

  it("cancels on the attempt timeout and returns a timeout terminal", async () => {
    const backend = new FakeKimiBackend();
    const harness = createKimiCodeAgentHarness({
      config: DEFAULT_PLUGIN_CONFIG,
      sessionStore: new MemoryBindingStore(),
      sdkLoader: async () => backend.module(),
    });
    const result = await harness.runAttempt(await makeAttempt({ prompt: "LONG", timeoutMs: 30 }));
    expect(result).toMatchObject({ terminal: { kind: "timeout", aborted: true } });
    expect([...backend.records.values()][0]?.cancelCount).toBe(1);
    await harness.dispose();
  });
});

describe("safe approval policy", () => {
  it("uses the official approval handler and rejects without host approval", async () => {
    const backend = new FakeKimiBackend();
    const harness = createKimiCodeAgentHarness({
      config: { ...DEFAULT_PLUGIN_CONFIG, approvalPolicy: "deny" },
      sessionStore: new MemoryBindingStore(),
      sdkLoader: async () => backend.module(),
    });
    const params = await makeAttempt({ prompt: "APPROVAL" });
    const result = await harness.runAttempt(params);
    expect(result).toMatchObject({ terminal: { kind: "ok" }, assistantTexts: ["approval:rejected"] });
    expect(params.hostCapabilities.requestApproval).not.toHaveBeenCalled();
    await harness.dispose();
  });

  it("safely rejects approvals on channels without interactive approval UI", async () => {
    const backend = new FakeKimiBackend();
    const harness = createKimiCodeAgentHarness({
      config: DEFAULT_PLUGIN_CONFIG,
      sessionStore: new MemoryBindingStore(),
      sdkLoader: async () => backend.module(),
    });
    const params = await makeAttempt({ prompt: "APPROVAL", messageChannel: "openclaw-weixin" });
    const result = await harness.runAttempt(params);
    expect(result).toMatchObject({
      terminal: { kind: "ok" },
      assistantTexts: ["approval:rejected"],
    });
    expect(params.hostCapabilities.requestApproval).not.toHaveBeenCalled();
    await harness.dispose();
  });

  it("maps an OpenClaw allow-once decision without inventing session scope", async () => {
    const backend = new FakeKimiBackend();
    const harness = createKimiCodeAgentHarness({
      config: DEFAULT_PLUGIN_CONFIG,
      sessionStore: new MemoryBindingStore(),
      sdkLoader: async () => backend.module(),
    });
    const params = await makeAttempt({ prompt: "APPROVAL" });
    const result = await harness.runAttempt(params);
    expect(result).toMatchObject({ assistantTexts: ["approval:approved"] });
    expect(params.hostCapabilities.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ allowedDecisions: ["allow-once", "deny"] }),
    );
    await harness.dispose();
  });
});
