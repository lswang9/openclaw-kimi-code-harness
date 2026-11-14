import { describe, expect, it, vi } from "vitest";
import { KimiEventBridge } from "../../src/events.js";
import { makeAttempt } from "../helpers/attempt.js";

describe("Kimi event projection", () => {
  it("maps cumulative and delta text, tools, usage, and terminal state", async () => {
    const params = await makeAttempt();
    const bridge = new KimiEventBridge(params);
    bridge.accept({ type: "turn.started", turnId: 1, agentId: "main" });
    bridge.accept({ type: "assistant.delta", turnId: 1, agentId: "main", delta: "hel" });
    bridge.accept({ type: "assistant.delta", turnId: 1, agentId: "main", delta: "lo" });
    bridge.accept({
      type: "tool.call.started",
      turnId: 1,
      toolCallId: "call-1",
      name: "Write",
      args: { path: "a.txt" },
    });
    bridge.accept({
      type: "tool.result",
      turnId: 1,
      toolCallId: "call-1",
      output: "ok",
    });
    bridge.accept({ type: "turn.step.completed", turnId: 1, usage: { output: 7 } });
    bridge.accept({ type: "turn.ended", turnId: 1, reason: "completed" });
    await bridge.drain();
    await expect(bridge.ended).resolves.toMatchObject({ reason: "completed" });
    expect(bridge.assistantText).toBe("hello");
    expect(vi.mocked(params.onPartialReply).mock.calls.map(([value]) => value)).toEqual([
      { text: "hel", delta: "hel" },
      { text: "hello", delta: "lo" },
    ]);
    expect(params.hostCapabilities.reportOutputTokens).toHaveBeenCalledWith(7);
    expect(params.observeToolTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "call-1",
        outcome: "success",
        nativeMutation: { mutatingAction: true, replaySafe: false },
      }),
    );
    expect(bridge.toolMetas).toEqual([
      { toolName: "Write", toolCallId: "call-1", isError: false },
    ]);
  });

  it("ignores stale turns and redacts native error text", async () => {
    const params = await makeAttempt();
    const bridge = new KimiEventBridge(params);
    bridge.accept({ type: "turn.started", turnId: 2 });
    bridge.accept({ type: "assistant.delta", turnId: 1, delta: "stale" });
    bridge.accept({ type: "error", code: "provider.auth_error", message: "Bearer secret" });
    await bridge.drain();
    expect(bridge.assistantText).toBe("");
    expect(bridge.promptError?.message).not.toContain("secret");
    expect(vi.mocked(params.onAgentEvent).mock.calls.at(-1)?.[0]).toMatchObject({
      stream: "error",
      data: { message: "Bearer [REDACTED]" },
    });
  });
});
