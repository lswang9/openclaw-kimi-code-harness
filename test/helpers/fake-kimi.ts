import type {
  KimiApprovalRequest,
  KimiApprovalResponse,
  KimiEvent,
  KimiHarness,
  KimiQuestionRequest,
  KimiQuestionResult,
  KimiPromptPart,
  KimiSession,
  KimiSdkModule,
  KimiTokenUsage,
} from "../../src/kimi-sdk.js";

export type FakeNativeRecord = {
  id: string;
  workDir: string;
  model: string;
  prompts: string[];
  permissionModes: string[];
  cancelCount: number;
};

export class FakeKimiBackend {
  readonly records = new Map<string, FakeNativeRecord>();
  private nextId = 0;

  module(): KimiSdkModule {
    return {
      createKimiHarness: () => new FakeKimiHarness(this),
    };
  }
}

export class FakeKimiHarness implements KimiHarness {
  constructor(private readonly backend: FakeKimiBackend) {}

  async getConfig() {
    return {
      defaultModel: "managed:kimi-code/kimi-for-coding",
      models: {
        "managed:kimi-code/kimi-for-coding": {
          provider: "managed:kimi-code",
          model: "kimi-for-coding",
          maxContextSize: 262_144,
        },
      },
    };
  }

  async createSession(options: {
    workDir: string;
    model: string;
    permission: "manual";
  }): Promise<KimiSession> {
    const id = `native-${++this.backend.nextId}`;
    this.backend.records.set(id, {
      id,
      workDir: options.workDir,
      model: options.model,
      prompts: [],
      permissionModes: [options.permission],
      cancelCount: 0,
    });
    return new FakeKimiSession(this.backend.records.get(id)!);
  }

  async resumeSession(options: { id: string }): Promise<KimiSession> {
    const record = this.backend.records.get(options.id);
    if (!record) {
      throw Object.assign(new Error("native session not found"), { code: "session.not_found" });
    }
    return new FakeKimiSession(record);
  }

  async deleteSession(id: string): Promise<void> {
    this.backend.records.delete(id);
  }

  async close(): Promise<void> {}
}

export class FakeKimiSession implements KimiSession {
  readonly id: string;
  readonly workDir: string;
  private readonly listeners = new Set<(event: KimiEvent) => void>();
  private approvalHandler:
    | ((request: KimiApprovalRequest) => KimiApprovalResponse | Promise<KimiApprovalResponse>)
    | undefined;
  private questionHandler:
    | ((request: KimiQuestionRequest) => KimiQuestionResult | Promise<KimiQuestionResult>)
    | undefined;
  private closed = false;
  private turnId = 0;
  private activeTurnId: number | undefined;

  constructor(private readonly record: FakeNativeRecord) {
    this.id = record.id;
    this.workDir = record.workDir;
  }

  onEvent(listener: (event: KimiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setApprovalHandler(
    handler:
      | ((request: KimiApprovalRequest) => KimiApprovalResponse | Promise<KimiApprovalResponse>)
      | undefined,
  ): void {
    this.approvalHandler = handler;
  }

  setQuestionHandler(
    handler:
      | ((request: KimiQuestionRequest) => KimiQuestionResult | Promise<KimiQuestionResult>)
      | undefined,
  ): void {
    this.questionHandler = handler;
  }

  async prompt(input: string | readonly KimiPromptPart[]): Promise<void> {
    if (this.closed) {
      throw Object.assign(new Error("Session is closed"), { code: "session.closed" });
    }
    const text =
      typeof input === "string"
        ? input
        : input.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n");
    this.record.prompts.push(text);
    const turnId = ++this.turnId;
    queueMicrotask(() => void this.runPrompt(text, turnId));
  }

  async cancel(): Promise<void> {
    this.record.cancelCount += 1;
    if (this.activeTurnId !== undefined) {
      const turnId = this.activeTurnId;
      this.activeTurnId = undefined;
      this.emit({ type: "turn.ended", turnId, agentId: "main", reason: "cancelled" });
    }
  }

  async setPermission(mode: "manual"): Promise<void> {
    this.record.permissionModes.push(mode);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }

  async getStatus(): Promise<{
    model?: string;
    usage?: { currentTurn?: KimiTokenUsage };
  }> {
    return {
      model: this.record.model,
      usage: { currentTurn: { inputOther: 10, output: 3 } },
    };
  }

  private async runPrompt(text: string, turnId: number): Promise<void> {
    this.activeTurnId = turnId;
    this.emit({ type: "turn.started", turnId, agentId: "main", sessionId: this.id });
    if (text.includes("APPROVAL")) {
      const response = (await this.approvalHandler?.({
        toolCallId: "call-approval",
        toolName: "Bash",
        action: "Run approval command",
        display: { kind: "generic", summary: "touch denied.txt" },
      })) ?? { decision: "cancelled" as const };
      this.emit({
        type: "tool.result",
        turnId,
        agentId: "main",
        toolCallId: "call-approval",
        output: response.decision,
        isError: response.decision !== "approved",
      });
      this.emitDelta(`approval:${response.decision}`, turnId);
    } else if (text.includes("QUESTION")) {
      const answer = await this.questionHandler?.({
        id: "question-1",
        turnId,
        questions: [
          {
            question: "Choose one",
            header: "Choice",
            options: [{ label: "A" }, { label: "B" }],
          },
        ],
      });
      this.emitDelta(`question:${JSON.stringify(answer)}`, turnId);
    } else if (text.includes("TOOL")) {
      this.emit({
        type: "tool.call.started",
        turnId,
        agentId: "main",
        toolCallId: "call-1",
        name: "Write",
        args: { path: "result.txt" },
      });
      this.emit({
        type: "tool.result",
        turnId,
        agentId: "main",
        toolCallId: "call-1",
        output: "written",
      });
      this.emitDelta("tool completed", turnId);
    } else if (text.includes("LONG")) {
      this.emitDelta("long answer started", turnId);
      return;
    } else {
      const lastLine = text.trim().split(/\r?\n/).at(-1) ?? "";
      this.emitDelta(`answer ${this.record.prompts.length}: `, turnId);
      this.emitDelta(lastLine, turnId);
    }
    this.emit({
      type: "turn.step.completed",
      turnId,
      agentId: "main",
      usage: { output: 3 },
    });
    this.activeTurnId = undefined;
    this.emit({ type: "turn.ended", turnId, agentId: "main", reason: "completed" });
  }

  private emitDelta(delta: string, turnId: number): void {
    this.emit({ type: "assistant.delta", turnId, agentId: "main", delta, block: 0 });
  }

  private emit(event: KimiEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
