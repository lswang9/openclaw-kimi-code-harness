import { createHash } from "node:crypto";

export type SessionBinding = Readonly<{
  schemaVersion: 1;
  nativeSessionId: string;
  openclawSessionId: string;
  sessionKey: string;
  agentId: string;
  workspaceDir: string;
  nativeModel: string;
  createdAt: number;
  updatedAt: number;
}>;

export type SessionBindingStore = Readonly<{
  lookup(key: string): Promise<SessionBinding | undefined>;
  register(key: string, value: SessionBinding): Promise<void>;
  delete(key: string): Promise<boolean>;
}>;

export type BindingIdentity = Readonly<{
  agentId: string;
  sessionKey: string;
  sessionId: string;
}>;

export function bindingKey(identity: BindingIdentity): string {
  const agentId = identity.agentId.trim();
  const sessionKey = identity.sessionKey.trim();
  const sessionId = identity.sessionId.trim();
  if (!agentId || !sessionKey || !sessionId) {
    throw new Error("Kimi Code session binding requires agentId, sessionKey, and sessionId");
  }
  const digest = createHash("sha256").update(sessionKey).digest("base64url");
  return `agent:${agentId}:session-key:${digest}`;
}

export function normalizeBinding(value: unknown): SessionBinding | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.nativeSessionId) ||
    !isNonEmptyString(value.openclawSessionId) ||
    !isNonEmptyString(value.sessionKey) ||
    !isNonEmptyString(value.agentId) ||
    !isNonEmptyString(value.workspaceDir) ||
    !isNonEmptyString(value.nativeModel) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    nativeSessionId: value.nativeSessionId.trim(),
    openclawSessionId: value.openclawSessionId.trim(),
    sessionKey: value.sessionKey.trim(),
    agentId: value.agentId.trim(),
    workspaceDir: value.workspaceDir,
    nativeModel: value.nativeModel.trim(),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function bindingMatchesIdentity(
  binding: SessionBinding,
  identity: BindingIdentity,
): boolean {
  return (
    binding.openclawSessionId === identity.sessionId &&
    binding.sessionKey === identity.sessionKey &&
    binding.agentId === identity.agentId
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
