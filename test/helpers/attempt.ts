import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddedRunAttemptParamsV2 } from "openclaw/plugin-sdk/agent-harness-runtime";
import { vi } from "vitest";
import type { SessionBinding, SessionBindingStore } from "../../src/session-binding.js";

export class MemoryBindingStore implements SessionBindingStore {
  readonly values = new Map<string, SessionBinding>();

  async lookup(key: string): Promise<SessionBinding | undefined> {
    return this.values.get(key);
  }

  async register(key: string, value: SessionBinding): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}

export async function makeAttempt(
  overrides: Record<string, unknown> = {},
): Promise<EmbeddedRunAttemptParamsV2> {
  const workspaceDir = await mkdtemp(join(tmpdir(), "kimi-harness-test-"));
  const hostCapabilities = {
    kind: "agent-harness-host-capability" as const,
    version: 1 as const,
    assertActive: vi.fn(),
    bindToolSurface: (tools: never[]) => tools,
    runBeforeToolCall: vi.fn(async () => ({ blocked: false })),
    requestApproval: vi.fn(async () => ({ id: "approval-1", decision: null })),
    waitForApproval: vi.fn(async () => ({
      decision: "allow-once",
      terminalReason: "user",
    })),
    reportOutputTokens: vi.fn(),
  };
  return {
    provider: "kimi",
    modelId: "kimi-for-coding",
    model: {
      id: "kimi-for-coding",
      provider: "kimi",
      api: "anthropic-messages",
      input: ["text", "image"],
    },
    agentId: "main",
    agentDir: workspaceDir,
    workspaceDir,
    sessionId: "openclaw-1",
    sessionKey: "agent:main:channel:one",
    sessionFile: join(workspaceDir, "session.jsonl"),
    runId: "run-1",
    prompt: "hello",
    timeoutMs: 2_000,
    config: {},
    hostCapabilities,
    onPartialReply: vi.fn(),
    onAgentEvent: vi.fn(),
    observeToolTerminal: vi.fn(() => ({
      executionStarted: true,
      sideEffectEvidence: true,
      effectReceipt: {},
    })),
    ...overrides,
  } as unknown as EmbeddedRunAttemptParamsV2;
}
