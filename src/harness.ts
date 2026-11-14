import {
  AgentHarnessPreflightError,
  AgentHarnessSessionCleanupError,
  clearActiveEmbeddedRun,
  setActiveEmbeddedRun,
  type AgentHarnessAttemptResult,
  type AgentHarnessResetParams,
  type AgentHarnessSessionDeletionMutation,
  type AgentHarnessSessionDeletionParams,
  type AgentHarnessV2,
  type EmbeddedRunAttemptParamsV2,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import type { KimiCodePluginConfig } from "./config.js";
import { actionableKimiError, isNativeSessionMissing } from "./errors.js";
import { KimiEventBridge } from "./events.js";
import { createKimiApprovalHandler, createKimiQuestionHandler } from "./interaction.js";
import { KeyedQueue } from "./keyed-queue.js";
import {
  loadKimiSdk,
  resolveNativeModel,
  type KimiHarness,
  type KimiSdkModule,
  type KimiSession,
} from "./kimi-sdk.js";
import { loadKimiNativeModelCatalog } from "./model-catalog.js";
import { buildKimiPrompt } from "./prompt.js";
import { safeErrorMessage } from "./redact.js";
import { buildKimiAttemptResult } from "./result.js";
import {
  bindingKey,
  bindingMatchesIdentity,
  normalizeBinding,
  type BindingIdentity,
  type SessionBinding,
  type SessionBindingStore,
} from "./session-binding.js";
import { supportsKimiCodeRoute } from "./support.js";
import { resolveWorkspaceDir } from "./workspace.js";

export type HarnessLogger = Readonly<{
  warn(message: string, meta?: unknown): void;
  info?(message: string, meta?: unknown): void;
}>;

export type CreateKimiCodeHarnessOptions = Readonly<{
  config: KimiCodePluginConfig;
  sessionStore: SessionBindingStore;
  sdkLoader?: (config: KimiCodePluginConfig) => Promise<KimiSdkModule>;
  logger?: HarnessLogger;
}>;

type LiveSession = {
  session: KimiSession;
  binding: SessionBinding;
};

const CANCEL_SETTLEMENT_TIMEOUT_MS = 10_000;

export function createKimiCodeAgentHarness(
  options: CreateKimiCodeHarnessOptions,
): AgentHarnessV2 {
  const sdkLoader = options.sdkLoader ?? loadKimiSdk;
  const queue = new KeyedQueue();
  const liveSessions = new Map<string, LiveSession>();
  let nativeHarnessPromise: Promise<KimiHarness> | undefined;
  let disposed = false;

  const getNativeHarness = (): Promise<KimiHarness> => {
    if (disposed) {
      throw new Error("Kimi Code harness is disposed");
    }
    nativeHarnessPromise ??= sdkLoader(options.config).then((sdk) =>
      sdk.createKimiHarness({
        ...(options.config.homeDir !== undefined ? { homeDir: options.config.homeDir } : {}),
        ...(options.config.configPath !== undefined
          ? { configPath: options.config.configPath }
          : {}),
        identity: {
          productName: "openclaw-kimi-code-harness",
          version: "0.1.0",
          platform: "openclaw",
        },
        uiMode: "openclaw-agent-harness",
      }),
    );
    nativeHarnessPromise.catch(() => {
      nativeHarnessPromise = undefined;
    });
    return nativeHarnessPromise;
  };

  const acquireSession = async (
    params: EmbeddedRunAttemptParamsV2,
    identity: BindingIdentity,
    key: string,
    workspaceDir: string,
  ): Promise<LiveSession> => {
    const nativeHarness = await getNativeHarness();
    params.hostCapabilities.assertActive();
    const config = await nativeHarness.getConfig();
    const nativeModel = resolveNativeModel(config, params.modelId);
    const rawStored = await options.sessionStore.lookup(key);
    const stored = normalizeBinding(rawStored);
    if (rawStored !== undefined && !stored) {
      await options.sessionStore.delete(key);
      options.logger?.warn("Deleted a malformed Kimi Code session binding", { key });
    }
    if (stored && !bindingMatchesIdentity(stored, identity)) {
      throw new AgentHarnessPreflightError(
        "The OpenClaw session generation changed while its Kimi Code binding was still active; reset the session before continuing",
      );
    }
    if (stored && (stored.workspaceDir !== workspaceDir || stored.nativeModel !== nativeModel)) {
      throw new AgentHarnessPreflightError(
        "The Kimi Code binding workspace or model changed; reset this OpenClaw session instead of attaching a different native session",
      );
    }
    const cached = liveSessions.get(key);
    if (cached && stored && cached.binding.nativeSessionId === stored.nativeSessionId) {
      return cached;
    }
    if (cached && !stored) {
      await closeLiveSession(key, cached, true);
    }
    let session: KimiSession;
    if (stored) {
      try {
        session = await nativeHarness.resumeSession({ id: stored.nativeSessionId });
      } catch (error) {
        if (isNativeSessionMissing(error)) {
          await options.sessionStore.delete(key);
        }
        throw actionableKimiError(error);
      }
    } else {
      session = await nativeHarness.createSession({
        workDir: workspaceDir,
        model: nativeModel,
        permission: "manual",
        metadata: {
          openclawAgentId: identity.agentId,
          openclawSessionId: identity.sessionId,
          openclawSessionKey: identity.sessionKey,
        },
      });
    }
    if (session.workDir !== workspaceDir) {
      await session.close().catch(() => undefined);
      throw new Error(
        `Kimi Code restored a different workDir (${session.workDir}); expected ${workspaceDir}`,
      );
    }
    await session.setPermission("manual");
    const binding: SessionBinding = stored ?? {
      schemaVersion: 1,
      nativeSessionId: session.id,
      openclawSessionId: identity.sessionId,
      sessionKey: identity.sessionKey,
      agentId: identity.agentId,
      workspaceDir,
      nativeModel,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = { session, binding: { ...binding, updatedAt: Date.now() } };
    await options.sessionStore.register(key, next.binding);
    liveSessions.set(key, next);
    return next;
  };

  const closeLiveSession = async (
    key: string,
    live: LiveSession,
    cancel: boolean,
  ): Promise<void> => {
    if (cancel) {
      await live.session.cancel().catch(() => undefined);
    }
    await live.session.close();
    if (liveSessions.get(key) === live) {
      liveSessions.delete(key);
    }
  };

  const runAttempt = async (
    params: EmbeddedRunAttemptParamsV2,
  ): Promise<AgentHarnessAttemptResult> => {
    const identity = bindingIdentity(params);
    const key = bindingKey(identity);
    return queue.run(key, async () => {
      assertAttemptAllowed(params);
      const workspaceDir = await resolveWorkspaceDir(params);
      const live = await acquireSession(params, identity, key, workspaceDir);
      return runNativeTurn(params, live, options.config);
    });
  };

  const reset = async (params: AgentHarnessResetParams): Promise<void> => {
    if (!params.sessionId || disposed) {
      return;
    }
    const identity = resetIdentity(params);
    const key = bindingKey(identity);
    await queue.run(key, async () => {
      const live = liveSessions.get(key);
      if (live) {
        await closeLiveSession(key, live, true);
      }
      await options.sessionStore.delete(key);
    });
  };

  const deleteSession = async <T>(
    params: AgentHarnessSessionDeletionParams,
    run: (mutation: AgentHarnessSessionDeletionMutation) => Promise<T>,
    deleteNative: boolean,
  ): Promise<T> => {
    const identity: BindingIdentity = {
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
    };
    const key = bindingKey(identity);
    return queue.run(key, async () => {
      params.assertCurrent();
      const stored = normalizeBinding(await options.sessionStore.lookup(key));
      const live = liveSessions.get(key);
      if (live) {
        await closeLiveSession(key, live, true);
      }
      let committed = false;
      const result = await run({
        commit: () => {
          committed = true;
        },
        rollback: () => {
          committed = false;
        },
      });
      if (!committed) {
        return result;
      }
      await options.sessionStore.delete(key);
      if (deleteNative && stored) {
        try {
          const nativeHarness = await getNativeHarness();
          await nativeHarness.deleteSession(stored.nativeSessionId);
        } catch (error) {
          if (!isNativeSessionMissing(error)) {
            throw new AgentHarnessSessionCleanupError(
              `OpenClaw deleted the session, but native Kimi Code cleanup failed: ${safeErrorMessage(error)}`,
              { cause: error },
            );
          }
        }
      }
      return result;
    });
  };

  return {
    id: "kimi-code",
    label: "Kimi Code native agent harness",
    autoSelection: { providerIds: [] },
    authBootstrap: "harness",
    contextManagement: "native",
    executionEnvironment: "host-only",
    supportsTurnScopedToolRestrictions: false,
    deliveryDefaults: { visibleReplies: "automatic" },
    supports: supportsKimiCodeRoute,
    loadModelCatalog: async () => loadKimiNativeModelCatalog(await getNativeHarness()),
    runAttempt,
    reset,
    withSessionDeletion: (params, run) => deleteSession(params, run, true),
    withSessionContextReset: (params, run) => deleteSession(params, run, false),
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      const errors: unknown[] = [];
      for (const [key, live] of [...liveSessions]) {
        try {
          await closeLiveSession(key, live, true);
        } catch (error) {
          errors.push(error);
        }
      }
      if (nativeHarnessPromise) {
        try {
          await (await nativeHarnessPromise).close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Kimi Code harness cleanup failed");
      }
    },
  };
}

async function runNativeTurn(
  params: EmbeddedRunAttemptParamsV2,
  live: LiveSession,
  config: KimiCodePluginConfig,
): Promise<AgentHarnessAttemptResult> {
  const { session, binding } = live;
  const bridge = new KimiEventBridge(params);
  let ended: Awaited<typeof bridge.ended> | undefined;
  let error: unknown;
  let timedOut = false;
  let externalAbort = false;
  let cancelPromise: Promise<void> | undefined;
  let activeHandle: Parameters<typeof clearActiveEmbeddedRun>[1] | undefined;
  const cancel = () => {
    cancelPromise ??= session.cancel().catch((cancelError: unknown) => {
      throw actionableKimiError(cancelError);
    });
    return cancelPromise;
  };
  const abort = () => {
    externalAbort = true;
    void cancel().catch(() => undefined);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    void cancel().catch(() => undefined);
  }, Math.max(1, params.timeoutMs));
  timeout.unref();
  const unsubscribe = session.onEvent((event) => bridge.accept(event));
  session.setApprovalHandler(createKimiApprovalHandler(params, config));
  session.setQuestionHandler(createKimiQuestionHandler(params, config));
  params.abortSignal?.addEventListener("abort", abort, { once: true });
  try {
    if (params.abortSignal?.aborted) {
      externalAbort = true;
      return buildKimiAttemptResult({ params, bridge, externalAbort, nativeModel: binding.nativeModel });
    }
    const prompt = await buildKimiPrompt(params, session.workDir);
    params.hostCapabilities.assertActive();
    const handle = {
      kind: "embedded" as const,
      runId: params.runId,
      ...(params.toolAuthorityFingerprint
        ? { toolAuthorityFingerprint: params.toolAuthorityFingerprint }
        : {}),
      ...(params.startedAtMs !== undefined ? { startedAtMs: params.startedAtMs } : {}),
      isStreaming: () => ended === undefined && !externalAbort && !timedOut,
      isAborted: () => externalAbort || timedOut,
      isCompacting: () => false,
      queueMessage: async () => {
        throw new Error("Kimi Code steering is not supported by this MVP");
      },
      cancel: abort,
      abort,
    };
    activeHandle = handle;
    setActiveEmbeddedRun(
      params.sessionId,
      handle,
      params.sessionKey,
      params.sessionFile,
      params.agentId,
    );
    params.userTurnTranscriptRecorder?.markSentToProvider?.();
    await session.prompt(prompt);
    if (externalAbort || timedOut) {
      await waitForCancellation(bridge.ended);
    } else {
      ended = await bridge.ended;
    }
    await bridge.drain();
    if (bridge.promptError && !error) {
      error = bridge.promptError;
    }
  } catch (caught) {
    error = actionableKimiError(caught);
    if (externalAbort || timedOut || params.abortSignal?.aborted) {
      await waitForCancellation(bridge.ended);
    }
  } finally {
    clearTimeout(timeout);
    params.abortSignal?.removeEventListener("abort", abort);
    unsubscribe();
    session.setApprovalHandler(undefined);
    session.setQuestionHandler(undefined);
    if (activeHandle) {
      clearActiveEmbeddedRun(
        params.sessionId,
        activeHandle,
        params.sessionKey,
        params.sessionFile,
        undefined,
      );
    }
    bridge.dispose();
  }
  let usage;
  if (!error || ended) {
    try {
      usage = (await session.getStatus()).usage?.currentTurn;
    } catch {
      usage = undefined;
    }
  }
  return buildKimiAttemptResult({
    params,
    bridge,
    ...(ended ? { ended } : {}),
    ...(error !== undefined ? { error } : {}),
    timedOut,
    externalAbort,
    nativeModel: binding.nativeModel,
    ...(usage ? { usage } : {}),
  });
}

async function waitForCancellation(ended: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CANCEL_SETTLEMENT_TIMEOUT_MS);
    timer.unref();
  });
  await Promise.race([ended.catch(() => undefined), timeout]);
  clearTimeout(timer!);
}

function bindingIdentity(params: EmbeddedRunAttemptParamsV2): BindingIdentity {
  const agentId = params.agentId?.trim() ?? "";
  const sessionKey = (params.sessionKey ?? params.sessionId).trim();
  if (!agentId || !sessionKey || !params.sessionId.trim()) {
    throw new AgentHarnessPreflightError(
      "Kimi Code requires non-empty OpenClaw agentId, sessionId, and sessionKey",
    );
  }
  return { agentId, sessionKey, sessionId: params.sessionId };
}

function resetIdentity(params: AgentHarnessResetParams): BindingIdentity {
  const sessionId = params.sessionId!.trim();
  const agentId = params.agentId?.trim() || agentFromSessionKey(params.sessionKey) || "main";
  const sessionKey = params.sessionKey?.trim() || sessionId;
  return { agentId, sessionKey, sessionId };
}

function agentFromSessionKey(sessionKey: string | undefined): string | undefined {
  const match = /^agent:([^:]+):/.exec(sessionKey?.trim() ?? "");
  return match?.[1];
}

function assertAttemptAllowed(params: EmbeddedRunAttemptParamsV2): void {
  params.hostCapabilities.assertActive();
  if (
    params.pluginHarnessToolPolicyRestricted ||
    params.disableTools ||
    (params.toolsAllow !== undefined && !params.toolsAllow.some((name) => name.trim() === "*"))
  ) {
    throw new AgentHarnessPreflightError(
      "Kimi Code owns its native tool surface and cannot reproduce this restricted OpenClaw tool policy; use the embedded runtime or remove the restriction",
    );
  }
}

