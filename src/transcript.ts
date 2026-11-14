import type {
  AgentHarnessAttemptResult,
  EmbeddedRunAttemptParamsV2,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import { appendAssistantMirrorMessageByIdentity } from "openclaw/plugin-sdk/session-transcript-runtime";

type AttemptTranscriptWriter = Readonly<{
  appendMessageAsync(
    message: NonNullable<AgentHarnessAttemptResult["lastAssistant"]>,
    options?: { idempotencyKey?: string },
  ): Promise<string | undefined>;
}>;

export async function persistKimiAttemptTranscript(
  params: EmbeddedRunAttemptParamsV2,
  result: AgentHarnessAttemptResult,
): Promise<AgentHarnessAttemptResult> {
  if (
    !("terminal" in result) ||
    result.terminal.kind !== "ok" ||
    !result.lastAssistant ||
    result.assistantTranscriptOwned
  ) {
    return result;
  }
  const sessionManager = (
    params as EmbeddedRunAttemptParamsV2 & {
      sessionManager?: AttemptTranscriptWriter;
    }
  ).sessionManager;
  const idempotencyKey = `${params.runId}:kimi-code:final-assistant`;
  if (!sessionManager) {
    const target = params.sessionTarget;
    if (!target?.agentId || !target.sessionId || !target.sessionKey || !target.storePath) {
      return result;
    }
    const appended = await appendAssistantMirrorMessageByIdentity({
      agentId: target.agentId,
      sessionId: target.sessionId,
      sessionKey: target.sessionKey,
      storePath: target.storePath,
      config: params.config,
      idempotencyKey,
      text: result.assistantTexts.join("\n\n"),
    });
    if (!appended.ok) {
      throw new Error(`OpenClaw rejected the Kimi assistant transcript: ${appended.reason}`);
    }
  } else {
    await sessionManager.appendMessageAsync(result.lastAssistant, { idempotencyKey });
  }
  return {
    ...result,
    assistantTranscriptOwned: true,
    assistantTranscriptIdempotencyKey: idempotencyKey,
  };
}
