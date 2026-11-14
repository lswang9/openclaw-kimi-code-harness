import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLUGIN_CONFIG } from "../../src/config.js";
import { createKimiCodeAgentHarness } from "../../src/harness.js";
import { makeAttempt, MemoryBindingStore } from "../helpers/attempt.js";

const enabled = process.env.KIMI_CODE_REAL_SMOKE === "1";
const exec = promisify(execFile);

describe("real Kimi Code smoke", { skip: !enabled }, () => {
  it("modifies and tests a project, streams, resumes, and cancels natively", async () => {
    const root = resolve(".smoke-tmp");
    await mkdir(root, { recursive: true });
    const workDir = await mkdtemp(join(root, "project-"));
    const store = new MemoryBindingStore();
    let harness = createKimiCodeAgentHarness({ config: DEFAULT_PLUGIN_CONFIG, sessionStore: store });
    try {
      await writeFile(join(workDir, "value.txt"), "before\n");
      await writeFile(
        join(workDir, "test.mjs"),
        'import { readFileSync } from "node:fs";\nif (readFileSync("value.txt", "utf8").trim() !== "after") process.exit(1);\n',
      );
      const partials: string[] = [];
      const events: unknown[] = [];
      const params = await makeAttempt({
        workspaceDir: workDir,
        agentDir: workDir,
        prompt:
          'Modify value.txt so its only content is "after". Then run "node test.mjs" and make it pass. Finish with a concise confirmation.',
        timeoutMs: 180_000,
        onPartialReply: (payload: { text?: string }) => {
          if (payload.text) partials.push(payload.text);
        },
        onAgentEvent: (event: unknown) => events.push(event),
      });
      const first = await harness.runAttempt(params);
      expect(first).toMatchObject({ terminal: { kind: "ok" } });
      expect(await readFile(join(workDir, "value.txt"), "utf8")).toBe("after\n");
      await expect(exec("node", ["test.mjs"], { cwd: workDir })).resolves.toBeDefined();
      expect(partials.length).toBeGreaterThan(0);
      expect(events.length).toBeGreaterThan(0);
      const nativeId = [...store.values.values()][0]?.nativeSessionId;
      expect(nativeId).toBeTruthy();
      await harness.dispose();

      harness = createKimiCodeAgentHarness({
        config: DEFAULT_PLUGIN_CONFIG,
        sessionStore: store,
      });
      const resumed = await harness.runAttempt(
        await makeAttempt({
          workspaceDir: workDir,
          agentDir: workDir,
          prompt: "Reply with exactly RESUME_OK and do not use any tools.",
          timeoutMs: 120_000,
        }),
      );
      expect(resumed).toMatchObject({ terminal: { kind: "ok" } });
      expect([...store.values.values()][0]?.nativeSessionId).toBe(nativeId);
      expect(resumed).toMatchObject({ assistantTexts: [expect.stringContaining("RESUME_OK")] });

      const abort = new AbortController();
      const cancelled = await harness.runAttempt(
        await makeAttempt({
          workspaceDir: workDir,
          agentDir: workDir,
          prompt: "Write a very long detailed essay about distributed systems. LONG cancellation smoke.",
          timeoutMs: 120_000,
          abortSignal: abort.signal,
          onPartialReply: () => abort.abort(),
        }),
      );
      expect(cancelled).toMatchObject({ terminal: { kind: "aborted", source: "external" } });
    } finally {
      await harness.dispose();
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("uses the real SDK approval handler and safely rejects a write", async () => {
    const root = resolve(".smoke-tmp");
    await mkdir(root, { recursive: true });
    const workDir = await mkdtemp(join(root, "deny-"));
    const harness = createKimiCodeAgentHarness({
      config: { ...DEFAULT_PLUGIN_CONFIG, approvalPolicy: "deny" },
      sessionStore: new MemoryBindingStore(),
    });
    try {
      const events: Array<{ stream: string; data: Record<string, unknown> }> = [];
      const result = await harness.runAttempt(
        await makeAttempt({
          workspaceDir: workDir,
          agentDir: workDir,
          prompt:
            "Use your shell tool to run exactly `touch denied.txt`. Do not use another tool or workaround. Then tell me the outcome.",
          timeoutMs: 120_000,
          onAgentEvent: (event: { stream: string; data: Record<string, unknown> }) =>
            events.push(event),
        }),
      );
      expect(result).toMatchObject({ terminal: { kind: "ok" } });
      expect(existsSync(join(workDir, "denied.txt"))).toBe(false);
      expect(
        events.some(
          (event) => event.stream === "approval" && event.data.status === "denied",
        ),
      ).toBe(true);
    } finally {
      await harness.dispose();
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
