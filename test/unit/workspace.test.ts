import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceDir } from "../../src/workspace.js";

describe("workspace resolution", () => {
  it("uses the prepared absolute cwd and canonicalizes it", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "kimi-workspace-"));
    await expect(resolveWorkspaceDir({ workspaceDir: workspace })).resolves.toBe(
      await realpath(workspace),
    );
  });

  it("never falls back to process.cwd or a missing directory", async () => {
    await expect(resolveWorkspaceDir({ workspaceDir: "relative" })).rejects.toThrow("absolute");
    await expect(resolveWorkspaceDir({})).rejects.toThrow("prepared workspaceDir");
    await expect(
      resolveWorkspaceDir({ workspaceDir: "/definitely/missing/kimi-code-workspace" }),
    ).rejects.toThrow("does not exist");
  });
});
