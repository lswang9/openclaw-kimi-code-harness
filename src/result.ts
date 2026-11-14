import {
  classifyAgentHarnessTerminalOutcome,
  type AgentHarnessAttemptResult,
  type AgentMessage,
  type EmbeddedRunAttemptParamsV2,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import type { KimiEventBridge, KimiTurnEnd } from "./events.js";
import type { KimiTokenUsage } from "./kimi-sdk.js";
import { normalizeNativeUsage } from "./events.js";

export function buildKimiAttemptResult(input: {
  params: EmbeddedRunAttemptParamsV2;
  bridge: KimiEventBridge;
  ended?: KimiTurnEnd;
  error?: unknown;
  timedOut?: boolean;
  externalAbort?: boolean;
  nativeModel: string;
  usage?: KimiTokenUsage;
}): AgentHarnessAttemptResult {
  const { params, bridge, ended } = input;
  const assistant = buildAssistantMessage(input);
  const terminal = resolveTerminal(input);
  const hasTools = bridge.toolMetas.length > 0;
  const failed = terminal.kind === "failed" || terminal.kind === "timeout" || terminal.kind === "aborted";
  const assistantTexts = bridge.assistantTexts;
  const messagesSnapshot: AgentMessage[] = assistant ? [assistant] : [];
  return {
    terminal,
    sessionIdUsed: params.sessionId,
    sessionFileUsed: params.sessionFile,
    agentHarnessId: "kimi-code",
    messagesSnapshot,
    assistantTexts,
    toolMetas: bridge.toolMetas,
    lastAssistant: assistant,
    currentAttemptAssistant: assistant,
    ...(ended?.reason === "completed" && assistant
      ? { currentAttemptCompletedAssistant: assistant }
      : {}),
    ...(ended?.reason === "completed" || ended?.reason === "cancelled"
      ? { hasSuccessfulModelResponse: assistantTexts.length > 0 }
      : {}),
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    replayMetadata: {
      hadPotentialSideEffects: hasTools,
      replaySafe: !hasTools && !failed,
    },
    currentAttemptReplayMetadata: {
      hadPotentialSideEffects: hasTools,
      replaySafe: !hasTools && !failed,
    },
    itemLifecycle: bridge.itemLifecycle,
    modelIterations: bridge.modelIterations,
    assistantTurns: bridge.modelIterations,
    ...(normalizeNativeUsage(input.usage)
      ? { attemptUsage: normalizeNativeUsage(input.usage)! }
      : {}),
    ...classifyTerminalOutcome(input),
  };
}

function resolveTerminal(input: {
  bridge: KimiEventBridge;
  ended?: KimiTurnEnd;
  error?: unknown;
  timedOut?: boolean;
  externalAbort?: boolean;
}): Extract<AgentHarnessAttemptResult, { terminal: unknown }>["terminal"] {
  if (input.timedOut) {
    return {
      kind: "timeout",
      phase: "prompt",
      source: input.externalAbort ? "external" : "runtime",
      aborted: true,
      ...(input.error !== undefined
        ? { failure: { source: "prompt" as const, error: input.error } }
        : {}),
    };
  }
  if (input.externalAbort || input.ended?.reason === "cancelled") {
    return {
      kind: "aborted",
      source: input.externalAbort ? "external" : "runtime",
      ...(input.error !== undefined
        ? { failure: { source: "prompt" as const, error: input.error } }
        : {}),
    };
  }
  const error = input.error ?? input.ended?.error ?? input.bridge.promptError;
  if (input.ended?.reason === "failed" || input.ended?.reason === "blocked" || error !== undefined) {
    return {
      kind: "failed",
      source: "prompt",
      error: error ?? `Kimi Code turn ended with reason "${input.ended?.reason}"`,
    };
  }
  return { kind: "ok" };
}

function classifyTerminalOutcome(input: {
  bridge: KimiEventBridge;
  ended?: KimiTurnEnd;
  error?: unknown;
}): Pick<AgentHarnessAttemptResult, "agentHarnessResultClassification"> {
  const classification = classifyAgentHarnessTerminalOutcome({
    assistantTexts: input.bridge.assistantTexts,
    reasoningText: input.bridge.thinkingText,
    promptError: input.error,
    turnCompleted: input.ended?.reason === "completed",
  });
  return classification ? { agentHarnessResultClassification: classification } : {};
}

function buildAssistantMessage(input: {
  params: EmbeddedRunAttemptParamsV2;
  bridge: KimiEventBridge;
  ended?: KimiTurnEnd;
  error?: unknown;
  nativeModel: string;
}): Extract<AgentMessage, { role: "assistant" }> | undefined {
  const text = input.bridge.assistantText;
  const thinking = input.bridge.thinkingText;
  if (!text && !thinking) {
    return undefined;
  }
  const content: Extract<AgentMessage, { role: "assistant" }>["content"] = [];
  if (thinking) {
    content.push({ type: "thinking", thinking });
  }
  if (text) {
    content.push({ type: "text", text });
  }
  const failed = input.ended?.reason === "failed" || input.ended?.reason === "blocked";
  return {
    role: "assistant",
    content,
    api: input.params.model.api,
    provider: input.params.provider,
    model: input.params.modelId,
    responseModel: input.params.modelId,
    stopReason:
      input.ended?.reason === "cancelled"
        ? "aborted"
        : failed || input.error !== undefined
          ? "error"
          : "stop",
    ...(input.error !== undefined || failed
      ? { errorMessage: "Kimi Code native turn failed; inspect the attempt terminal error" }
      : {}),
    usage: {
      input: 0,
      output: input.bridge.totalOutputTokens,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: input.bridge.totalOutputTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  };
}
