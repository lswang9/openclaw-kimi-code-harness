import { describe, expect, it, vi } from "vitest";
import { persistKimiAttemptTranscript } from "../../src/transcript.js";
import { makeAttempt } from "../helpers/attempt.js";

describe("assistant transcript persistence", () => {
  it("persists the final assistant once with an idempotency key", async () => {
    const appendMessageAsync = vi.fn(async () => "entry-1");
    const params = await makeAttempt({ sessionManager: { appendMessageAsync } });
    const lastAssistant = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "hello" }],
      api: "anthropic-messages",
      provider: "kimi",
      model: "kimi-for-coding",
      usage: {
        input: 0,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: 1,
    };
    const result = await persistKimiAttemptTranscript(params, {
      terminal: { kind: "ok" },
      sessionIdUsed: params.sessionId,
      messagesSnapshot: [lastAssistant],
      assistantTexts: ["hello"],
      toolMetas: [],
      lastAssistant,
      didSendViaMessagingTool: false,
      messagingToolSentTexts: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
      cloudCodeAssistFormatError: false,
      replayMetadata: { hadPotentialSideEffects: false, replaySafe: true },
      itemLifecycle: { startedCount: 0, completedCount: 0, activeCount: 0 },
    });
    expect(appendMessageAsync).toHaveBeenCalledWith(lastAssistant, {
      idempotencyKey: "run-1:kimi-code:final-assistant",
    });
    expect(result).toMatchObject({
      assistantTranscriptOwned: true,
      assistantTranscriptIdempotencyKey: "run-1:kimi-code:final-assistant",
    });
  });

  it("does not persist aborted turns or duplicate an owned assistant", async () => {
    const appendMessageAsync = vi.fn();
    const params = await makeAttempt({ sessionManager: { appendMessageAsync } });
    const result = await persistKimiAttemptTranscript(params, {
      terminal: { kind: "aborted", source: "external" },
      sessionIdUsed: params.sessionId,
      messagesSnapshot: [],
      assistantTexts: [],
      toolMetas: [],
      lastAssistant: undefined,
      didSendViaMessagingTool: false,
      messagingToolSentTexts: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
      cloudCodeAssistFormatError: false,
      replayMetadata: { hadPotentialSideEffects: false, replaySafe: true },
      itemLifecycle: { startedCount: 0, completedCount: 0, activeCount: 0 },
    });
    expect(appendMessageAsync).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("assistantTranscriptOwned");
  });
});
