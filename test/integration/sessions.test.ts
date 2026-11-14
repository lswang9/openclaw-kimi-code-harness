import { describe, expect, it } from "vitest";
import { DEFAULT_PLUGIN_CONFIG } from "../../src/config.js";
import { createKimiCodeAgentHarness } from "../../src/harness.js";
import { bindingKey } from "../../src/session-binding.js";
import { makeAttempt, MemoryBindingStore } from "../helpers/attempt.js";
import { FakeKimiBackend } from "../helpers/fake-kimi.js";

function harness(backend: FakeKimiBackend, store: MemoryBindingStore) {
  return createKimiCodeAgentHarness({
    config: DEFAULT_PLUGIN_CONFIG,
    sessionStore: store,
    sdkLoader: async () => backend.module(),
  });
}

describe("mocked native session integration", () => {
  it("creates once and runs two consecutive turns in the same native session", async () => {
    const backend = new FakeKimiBackend();
    const store = new MemoryBindingStore();
    const runtime = harness(backend, store);
    const firstParams = await makeAttempt({ prompt: "first" });
    const first = await runtime.runAttempt(firstParams);
    const second = await runtime.runAttempt(
      await makeAttempt({ prompt: "second", workspaceDir: firstParams.workspaceDir }),
    );
    expect(first).toMatchObject({ terminal: { kind: "ok" } });
    expect(second).toMatchObject({ terminal: { kind: "ok" } });
    expect(backend.records).toHaveLength(1);
    const record = [...backend.records.values()][0]!;
    expect(record.prompts).toHaveLength(2);
    expect(record.prompts[0]).toContain("first");
    expect(record.prompts[1]).toContain("second");
    expect(second).toMatchObject({
      assistantTexts: ["answer 2: second"],
      lastAssistant: { model: "kimi-for-coding", responseModel: "kimi-for-coding" },
    });
    await runtime.dispose();
  });

  it("resumes the persisted mapping after a Gateway/plugin restart", async () => {
    const backend = new FakeKimiBackend();
    const store = new MemoryBindingStore();
    const before = harness(backend, store);
    const firstParams = await makeAttempt({ prompt: "before restart" });
    await before.runAttempt(firstParams);
    const nativeId = [...backend.records.keys()][0]!;
    await before.dispose();

    const after = harness(backend, store);
    const result = await after.runAttempt(
      await makeAttempt({ prompt: "after restart", workspaceDir: firstParams.workspaceDir }),
    );
    expect(result).toMatchObject({
      terminal: { kind: "ok" },
      assistantTexts: ["answer 2: after restart"],
    });
    expect(backend.records).toHaveLength(1);
    expect(backend.records.get(nativeId)?.prompts).toHaveLength(2);
    await after.dispose();
  });

  it("never mixes two OpenClaw sessions or two agents", async () => {
    const backend = new FakeKimiBackend();
    const store = new MemoryBindingStore();
    const runtime = harness(backend, store);
    await runtime.runAttempt(
      await makeAttempt({ sessionId: "oc-a", sessionKey: "agent:main:a", prompt: "session A" }),
    );
    await runtime.runAttempt(
      await makeAttempt({ sessionId: "oc-b", sessionKey: "agent:main:b", prompt: "session B" }),
    );
    await runtime.runAttempt(
      await makeAttempt({
        agentId: "other",
        sessionId: "oc-a",
        sessionKey: "agent:other:a",
        prompt: "other agent",
      }),
    );
    expect(backend.records).toHaveLength(3);
    expect([...backend.records.values()].map((record) => record.prompts.at(-1))).toEqual([
      expect.stringContaining("session A"),
      expect.stringContaining("session B"),
      expect.stringContaining("other agent"),
    ]);
    await runtime.dispose();
  });

  it("invalidates a missing native session and creates fresh only on an explicit retry", async () => {
    const backend = new FakeKimiBackend();
    const store = new MemoryBindingStore();
    const runtime = harness(backend, store);
    const params = await makeAttempt({ prompt: "original" });
    await runtime.runAttempt(params);
    await runtime.dispose();
    const key = bindingKey({
      agentId: "main",
      sessionKey: "agent:main:channel:one",
      sessionId: "openclaw-1",
    });
    backend.records.clear();
    const restarted = harness(backend, store);
    await expect(
      restarted.runAttempt(
        await makeAttempt({ prompt: "missing", workspaceDir: params.workspaceDir }),
      ),
    ).rejects.toThrow("native session no longer exists");
    expect(store.values.has(key)).toBe(false);
    const retried = await restarted.runAttempt(
      await makeAttempt({ prompt: "fresh retry", workspaceDir: params.workspaceDir }),
    );
    expect(retried).toMatchObject({ terminal: { kind: "ok" } });
    expect(backend.records).toHaveLength(1);
    await restarted.dispose();
  });

  it("reset detaches the old native session and the next turn creates a new one", async () => {
    const backend = new FakeKimiBackend();
    const store = new MemoryBindingStore();
    const runtime = harness(backend, store);
    await runtime.runAttempt(await makeAttempt({ prompt: "before reset" }));
    await runtime.reset?.({
      agentId: "main",
      sessionKey: "agent:main:channel:one",
      sessionId: "openclaw-1",
      reason: "reset",
    });
    expect(store.values).toHaveLength(0);
    await runtime.runAttempt(await makeAttempt({ prompt: "after reset" }));
    expect(backend.records).toHaveLength(2);
    await runtime.dispose();
  });

  it("deletes native state only after OpenClaw commits deletion", async () => {
    const backend = new FakeKimiBackend();
    const store = new MemoryBindingStore();
    const runtime = harness(backend, store);
    await runtime.runAttempt(await makeAttempt({ prompt: "delete me" }));
    const params = {
      agentId: "main",
      sessionKey: "agent:main:channel:one",
      sessionId: "openclaw-1",
      assertCurrent: () => {},
    };
    const rolledBack = await runtime.withSessionDeletion?.(params, async (mutation) => {
      mutation.rollback();
      return "rolled back";
    });
    expect(rolledBack).toBe("rolled back");
    expect(backend.records).toHaveLength(1);
    const committed = await runtime.withSessionDeletion?.(params, async (mutation) => {
      mutation.commit();
      return "committed";
    });
    expect(committed).toBe("committed");
    expect(backend.records).toHaveLength(0);
    expect(store.values).toHaveLength(0);
    await runtime.dispose();
  });
});
