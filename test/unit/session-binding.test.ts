import { describe, expect, it } from "vitest";
import {
  bindingKey,
  bindingMatchesIdentity,
  normalizeBinding,
  type SessionBinding,
} from "../../src/session-binding.js";

const identity = { agentId: "main", sessionKey: "agent:main:one", sessionId: "oc-1" };
const binding: SessionBinding = {
  schemaVersion: 1,
  nativeSessionId: "native-1",
  openclawSessionId: "oc-1",
  sessionKey: identity.sessionKey,
  agentId: identity.agentId,
  workspaceDir: "/tmp/work",
  nativeModel: "managed:kimi-code/kimi-for-coding",
  createdAt: 1,
  updatedAt: 2,
};

describe("session bindings", () => {
  it("isolates agents and session keys", () => {
    expect(bindingKey(identity)).not.toBe(bindingKey({ ...identity, agentId: "other" }));
    expect(bindingKey(identity)).not.toBe(bindingKey({ ...identity, sessionKey: "other" }));
    expect(bindingKey(identity)).toBe(bindingKey(identity));
  });

  it("validates persisted rows and physical identity", () => {
    expect(normalizeBinding(binding)).toEqual(binding);
    expect(normalizeBinding({ ...binding, nativeSessionId: "" })).toBeUndefined();
    expect(normalizeBinding({ schemaVersion: 2 })).toBeUndefined();
    expect(bindingMatchesIdentity(binding, identity)).toBe(true);
    expect(bindingMatchesIdentity(binding, { ...identity, sessionId: "new" })).toBe(false);
  });
});
