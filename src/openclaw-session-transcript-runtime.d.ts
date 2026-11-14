declare module "openclaw/plugin-sdk/session-transcript-runtime" {
  export function appendSessionTranscriptMessageByIdentity(params: {
    agentId: string;
    sessionId: string;
    sessionKey: string;
    storePath: string;
    config?: unknown;
    idempotencyKey: string;
    message: unknown;
  } & Record<string, unknown>): Promise<
    { ok: true } | { ok: false; reason: string; code?: string }
  >;

  export function appendAssistantMirrorMessageByIdentity(params: {
    agentId: string;
    sessionId: string;
    sessionKey: string;
    storePath: string;
    config?: unknown;
    idempotencyKey: string;
    text: string;
  } & Record<string, unknown>): Promise<
    { ok: true } | { ok: false; reason: string; code?: string }
  >;
}
