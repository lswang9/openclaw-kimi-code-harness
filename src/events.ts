import type { EmbeddedRunAttemptParamsV2 } from "openclaw/plugin-sdk/agent-harness-runtime";
import type { KimiEvent, KimiTokenUsage } from "./kimi-sdk.js";
import { safeErrorMessage } from "./redact.js";

export type KimiTurnEnd = Readonly<{
  turnId?: number;
  reason: "completed" | "cancelled" | "failed" | "blocked";
  error?: unknown;
}>;

export type NativeToolMeta = {
  toolName: string;
  toolCallId?: string;
  isError?: boolean;
};

export class KimiEventBridge {
  readonly ended: Promise<KimiTurnEnd>;
  private resolveEnded!: (event: KimiTurnEnd) => void;
  private rejectEnded!: (error: Error) => void;
  private chain: Promise<void> = Promise.resolve();
  private activeTurnId: number | undefined;
  private disposed = false;
  private callbackError: Error | undefined;
  private streamError: Error | undefined;
  private readonly textByBlock = new Map<string, string>();
  private readonly thinkingByBlock = new Map<string, string>();
  private readonly toolNames = new Map<string, string>();
  private readonly tools: NativeToolMeta[] = [];
  private readonly completedToolIds = new Set<string>();
  private outputTokens = 0;
  private modelIterationCount = 0;
  private startedCount = 0;

  constructor(private readonly params: EmbeddedRunAttemptParamsV2) {
    this.ended = new Promise<KimiTurnEnd>((resolve, reject) => {
      this.resolveEnded = resolve;
      this.rejectEnded = reject;
    });
    void this.ended.catch(() => undefined);
  }

  accept(event: KimiEvent): void {
    if (this.disposed) {
      return;
    }
    this.chain = this.chain.then(() => this.project(event));
    void this.chain.catch((error: unknown) => {
      this.callbackError ??= new Error(`OpenClaw event callback failed: ${safeErrorMessage(error)}`, {
        cause: error,
      });
    });
  }

  async drain(): Promise<void> {
    await this.chain;
    if (this.callbackError) {
      throw this.callbackError;
    }
  }

  get assistantTexts(): string[] {
    return [...this.textByBlock.values()].filter((text) => text.length > 0);
  }

  get assistantText(): string {
    return this.assistantTexts.join("\n\n");
  }

  get thinkingText(): string {
    return [...this.thinkingByBlock.values()].join("\n\n");
  }

  get toolMetas(): NativeToolMeta[] {
    return [...this.tools];
  }

  get modelIterations(): number {
    return this.modelIterationCount;
  }

  get totalOutputTokens(): number {
    return this.outputTokens;
  }

  get itemLifecycle(): { startedCount: number; completedCount: number; activeCount: number } {
    return {
      startedCount: this.startedCount,
      completedCount: this.completedToolIds.size,
      activeCount: Math.max(0, this.startedCount - this.completedToolIds.size),
    };
  }

  get promptError(): Error | undefined {
    return this.streamError ?? this.callbackError;
  }

  dispose(): void {
    this.disposed = true;
  }

  private async project(event: KimiEvent): Promise<void> {
    const type = event.type;
    if (type === "turn.started") {
      this.activeTurnId = readNumber(event.turnId) ?? this.activeTurnId;
      await this.emit("lifecycle", { phase: "start", native: "kimi-code", ...event });
      return;
    }
    if (!this.isCurrentTurn(event) && type !== "error" && type !== "warning") {
      return;
    }
    switch (type) {
      case "assistant.delta":
        await this.assistantDelta(event);
        break;
      case "thinking.delta":
        await this.thinkingDelta(event);
        break;
      case "tool.call.started":
        await this.toolStarted(event);
        break;
      case "tool.result":
        await this.toolResult(event);
        break;
      case "tool.updated":
        await this.emit("tool", { phase: "update", ...event });
        break;
      case "turn.step.started":
        await this.emit("lifecycle", { phase: "step_started", ...event });
        break;
      case "turn.step.completed":
        await this.stepCompleted(event);
        break;
      case "turn.step.retrying":
      case "turn.step.interrupted":
        await this.emit("status", { phase: type, ...event });
        break;
      case "turn.ended": {
        const turnId = readNumber(event.turnId);
        const ended: KimiTurnEnd = {
          ...(turnId !== undefined ? { turnId } : {}),
          reason: readTurnReason(event.reason),
          ...(event.error !== undefined ? { error: event.error } : {}),
        };
        await this.emit("lifecycle", { phase: "end", ...event });
        this.resolveEnded(ended);
        break;
      }
      case "error": {
        const code = readString(event.code) ?? "internal";
        const message = safeErrorMessage(readString(event.message) ?? "Unknown Kimi Code error");
        this.streamError ??= new Error(`Kimi Code ${code}: ${message}`);
        await this.emit("error", { ...event, code, message });
        this.rejectEnded(this.streamError);
        break;
      }
      case "warning":
        await this.emit("status", { phase: "warning", ...event });
        break;
      case "compaction.started":
      case "compaction.blocked":
      case "compaction.cancelled":
      case "compaction.completed":
        await this.emit("compaction", { phase: type, ...event });
        break;
      case "agent.status.updated":
      case "session.meta.updated":
      case "background.task.started":
      case "background.task.terminated":
      case "subagent.spawned":
      case "subagent.started":
      case "subagent.completed":
      case "subagent.failed":
      case "subagent.cancelled":
        await this.emit("status", { phase: type, ...event });
        break;
      default:
        break;
    }
  }

  private async assistantDelta(event: KimiEvent): Promise<void> {
    const delta = readString(event.delta);
    if (!delta) {
      return;
    }
    const itemId = this.itemId(event, "assistant");
    const text = `${this.textByBlock.get(itemId) ?? ""}${delta}`;
    this.textByBlock.set(itemId, text);
    await this.params.onPartialReply?.({ text, delta });
    await this.emit("assistant", { phase: "delta", itemId, text, delta });
  }

  private async thinkingDelta(event: KimiEvent): Promise<void> {
    const delta = readString(event.delta);
    if (!delta) {
      return;
    }
    const itemId = this.itemId(event, "thinking");
    const text = `${this.thinkingByBlock.get(itemId) ?? ""}${delta}`;
    this.thinkingByBlock.set(itemId, text);
    await this.emit("thinking", { phase: "delta", itemId, text, delta });
  }

  private async toolStarted(event: KimiEvent): Promise<void> {
    const toolCallId = readString(event.toolCallId);
    const toolName = readString(event.name) ?? "unknown";
    if (toolCallId) {
      this.toolNames.set(toolCallId, toolName);
    }
    this.startedCount += 1;
    this.tools.push({ toolName, ...(toolCallId ? { toolCallId } : {}) });
    await this.emit("tool", {
      phase: "start",
      name: toolName,
      ...(toolCallId ? { itemId: toolCallId, toolCallId } : {}),
      args: isRecord(event.args) ? event.args : {},
    });
  }

  private async toolResult(event: KimiEvent): Promise<void> {
    const toolCallId = readString(event.toolCallId);
    const toolName = (toolCallId ? this.toolNames.get(toolCallId) : undefined) ?? "unknown";
    if (toolCallId) {
      this.completedToolIds.add(toolCallId);
    }
    const isError = event.isError === true;
    const meta = this.tools.findLast((tool) => tool.toolCallId === toolCallId);
    if (meta) {
      meta.isError = isError;
    } else {
      this.tools.push({ toolName, ...(toolCallId ? { toolCallId } : {}), isError });
    }
    this.params.observeToolTerminal?.({
      ...(toolCallId ? { toolCallId } : {}),
      toolName,
      result: event.output,
      executionStarted: true,
      outcome: isError ? "failure" : "success",
      nativeMutation: { mutatingAction: true, replaySafe: false },
    });
    await this.emit("tool", {
      phase: "result",
      name: toolName,
      ...(toolCallId ? { itemId: toolCallId, toolCallId } : {}),
      isError,
      result: event.output,
    });
  }

  private async stepCompleted(event: KimiEvent): Promise<void> {
    this.modelIterationCount += 1;
    const usage = isRecord(event.usage) ? event.usage : undefined;
    const output = usage ? readNumber(usage.output) : undefined;
    if (output !== undefined && output > 0) {
      this.outputTokens += output;
      this.params.hostCapabilities.reportOutputTokens?.(output);
    }
    await this.emit("lifecycle", { phase: "step_completed", ...event });
  }

  private isCurrentTurn(event: KimiEvent): boolean {
    const turnId = readNumber(event.turnId);
    return this.activeTurnId === undefined || turnId === undefined || turnId === this.activeTurnId;
  }

  private itemId(event: KimiEvent, prefix: string): string {
    const agentId = readString(event.agentId) ?? "main";
    const turnId = readNumber(event.turnId) ?? this.activeTurnId ?? 0;
    const block = readNumber(event.block) ?? 0;
    return `${prefix}:${agentId}:${turnId}:${block}`;
  }

  private async emit(stream: string, data: Record<string, unknown>): Promise<void> {
    await this.params.onAgentEvent?.({ stream, data });
  }
}

export function readTurnReason(value: unknown): KimiTurnEnd["reason"] {
  return value === "cancelled" || value === "failed" || value === "blocked" ? value : "completed";
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeNativeUsage(usage: KimiTokenUsage | undefined) {
  if (!usage) {
    return undefined;
  }
  const input = Math.max(0, usage.inputOther + (usage.inputCacheRead ?? 0));
  const cacheRead = Math.max(0, usage.inputCacheRead ?? 0);
  const cacheWrite = Math.max(0, usage.inputCacheCreation ?? 0);
  const output = Math.max(0, usage.output);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
