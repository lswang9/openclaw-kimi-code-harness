import { describe, expect, it } from "vitest";
import { actionableKimiError, isNativeSessionMissing } from "../../src/errors.js";

describe("error conversion", () => {
  it("provides an authentication remedy without leaking credentials", () => {
    const result = actionableKimiError(
      Object.assign(new Error("401 Bearer secret"), { code: "provider.auth_error" }),
    );
    expect(result.message).toContain("kimi login");
    expect(result.message).not.toContain("Bearer secret");
  });

  it("recognizes missing native sessions", () => {
    expect(isNativeSessionMissing({ code: "session.not_found" })).toBe(true);
    expect(actionableKimiError({ code: "session.not_found", message: "missing" }).message).toContain(
      "Reset",
    );
  });

  it("keeps SDK and workspace errors actionable", () => {
    expect(actionableKimiError(new Error("module incompatible")).message).toContain(
      "module incompatible",
    );
  });
});
