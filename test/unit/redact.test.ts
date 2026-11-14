import { describe, expect, it } from "vitest";
import { redactSecrets, redactString, safeErrorMessage } from "../../src/redact.js";

describe("credential redaction", () => {
  it("redacts bearer tokens and credential fields", () => {
    expect(redactString("Bearer abc.def.123")).toBe("Bearer [REDACTED]");
    expect(redactString("api_key=sk-secret")).toBe("api_key=[REDACTED]");
    expect(
      redactSecrets({
        apiKey: "sk-secret",
        nested: { oauth_token: "oauth-secret", safe: "ok" },
      }),
    ).toEqual({ apiKey: "[REDACTED]", nested: { oauth_token: "[REDACTED]", safe: "ok" } });
    expect(safeErrorMessage(new Error("Authorization: Bearer secret-token"))).not.toContain(
      "secret-token",
    );
  });
});
