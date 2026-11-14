import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { KimiCodePluginConfig } from "./config.js";
import { safeErrorMessage } from "./redact.js";

export type KimiEvent = Readonly<Record<string, unknown> & { type: string }>;
export type KimiUnsubscribe = () => void;

export type KimiApprovalRequest = Readonly<{
  toolCallId: string;
  toolName: string;
  action: string;
  display: unknown;
  agentId?: string;
  turnId?: number;
}>;

export type KimiApprovalResponse = Readonly<{
  decision: "approved" | "rejected" | "cancelled";
  scope?: "session";
  feedback?: string;
}>;

export type KimiQuestionRequest = Readonly<{
  id?: string;
  turnId?: number;
  toolCallId?: string;
  questions: readonly KimiQuestionItem[];
}>;

export type KimiQuestionItem = Readonly<{
  question: string;
  header?: string;
  body?: string;
  options: readonly { label: string; description?: string }[];
  multiSelect?: boolean;
  otherLabel?: string;
  otherDescription?: string;
}>;

export type KimiQuestionResult =
  | null
  | Record<string, string | true>
  | { answers: Record<string, string | true> };

export type KimiPromptPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: { url: string } };

export type KimiSession = Readonly<{
  id: string;
  workDir: string;
  onEvent(listener: (event: KimiEvent) => void): KimiUnsubscribe;
  setApprovalHandler(
    handler:
      | ((request: KimiApprovalRequest) => KimiApprovalResponse | Promise<KimiApprovalResponse>)
      | undefined,
  ): void;
  setQuestionHandler(
    handler:
      | ((request: KimiQuestionRequest) => KimiQuestionResult | Promise<KimiQuestionResult>)
      | undefined,
  ): void;
  prompt(input: string | readonly KimiPromptPart[]): Promise<void>;
  cancel(): Promise<void>;
  setPermission(mode: "manual"): Promise<void>;
  close(): Promise<void>;
  getStatus(): Promise<{
    model?: string;
    usage?: {
      currentTurn?: KimiTokenUsage;
      total?: KimiTokenUsage;
    };
  }>;
}>;

export type KimiTokenUsage = Readonly<{
  inputOther: number;
  output: number;
  inputCacheRead?: number;
  inputCacheCreation?: number;
}>;

export type KimiModelAlias = Readonly<{
  provider: string;
  model: string;
  maxContextSize: number;
  displayName?: string;
}>;

export type KimiConfig = Readonly<{
  defaultModel?: string;
  models?: Record<string, KimiModelAlias>;
}>;

export type KimiHarness = Readonly<{
  getConfig(): Promise<KimiConfig>;
  createSession(options: {
    workDir: string;
    model: string;
    permission: "manual";
    metadata?: Record<string, string>;
  }): Promise<KimiSession>;
  resumeSession(options: { id: string }): Promise<KimiSession>;
  deleteSession(id: string): Promise<void>;
  close(): Promise<void>;
}>;

export type KimiSdkModule = Readonly<{
  createKimiHarness(options: {
    homeDir?: string;
    configPath?: string;
    identity: {
      productName: string;
      version: string;
      platform: string;
    };
    uiMode: string;
    nonInteractive?: boolean;
  }): KimiHarness;
}>;

export async function loadKimiSdk(config: KimiCodePluginConfig): Promise<KimiSdkModule> {
  const override = config.sdkModule;
  if (override) {
    return importSdk(override, true);
  }
  try {
    return await importSdk("@moonshot-ai/kimi-code-sdk", false);
  } catch (packageError) {
    try {
      const bundled = new URL("../vendor/kimi-code-sdk.mjs", import.meta.url).href;
      return await importSdk(bundled, false);
    } catch (bundledError) {
      throw new Error(
        "Kimi Code SDK is unavailable. Use the package's bundled official-source runtime, install a compatible @moonshot-ai/kimi-code-sdk release, or set sdkModule to an absolute built SDK module path. " +
          `Package import: ${safeErrorMessage(packageError)}; bundled import: ${safeErrorMessage(bundledError)}`,
        { cause: bundledError },
      );
    }
  }
}

async function importSdk(specifier: string, explicit: boolean): Promise<KimiSdkModule> {
  const normalized = normalizeModuleSpecifier(specifier, explicit);
  let loaded: unknown;
  try {
    loaded = await import(normalized);
  } catch (error) {
    throw new Error(`Cannot load Kimi Code SDK module ${normalized}: ${safeErrorMessage(error)}`, {
      cause: error,
    });
  }
  if (!isRecord(loaded) || typeof loaded.createKimiHarness !== "function") {
    throw new Error(
      `Incompatible Kimi Code SDK module ${normalized}: missing public createKimiHarness export`,
    );
  }
  return loaded as KimiSdkModule;
}

function normalizeModuleSpecifier(specifier: string, explicit: boolean): string {
  const value = specifier.trim();
  if (value.startsWith("file:")) {
    return value;
  }
  if (isAbsolute(value)) {
    return pathToFileURL(value).href;
  }
  if (explicit && (value.startsWith(".") || value.startsWith("/"))) {
    return pathToFileURL(resolve(value)).href;
  }
  return value;
}

export function resolveNativeModel(config: KimiConfig, requestedModelId: string): string {
  const requested = requestedModelId.trim();
  if (!requested) {
    throw new Error("Kimi Code requires a non-empty OpenClaw model id");
  }
  const models = config.models ?? {};
  if (config.defaultModel && modelEntryMatches(config.defaultModel, models[config.defaultModel], requested)) {
    return config.defaultModel;
  }
  const matches = Object.entries(models)
    .filter(([alias, entry]) => modelEntryMatches(alias, entry, requested))
    .map(([alias]) => alias);
  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length > 1) {
    throw new Error(
      `Kimi Code model "${requested}" is ambiguous in native config. Set its desired native alias as default_model in config.toml, then retry.`,
    );
  }
  throw new Error(
    `Kimi Code native config has no model matching "${requested}". Run "kimi login" or configure the corresponding model alias in config.toml; OpenClaw credentials are not substituted.`,
  );
}

function modelEntryMatches(
  alias: string,
  entry: KimiModelAlias | undefined,
  requested: string,
): boolean {
  return alias === requested || alias.endsWith(`/${requested}`) || entry?.model === requested;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
