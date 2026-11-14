export type ApprovalPolicy = "openclaw" | "deny";

export type KimiCodePluginConfig = Readonly<{
  homeDir?: string;
  configPath?: string;
  sdkModule?: string;
  approvalPolicy: ApprovalPolicy;
  approvalTimeoutMs: number;
}>;

export const DEFAULT_PLUGIN_CONFIG: KimiCodePluginConfig = {
  approvalPolicy: "openclaw",
  approvalTimeoutMs: 120_000,
};

export function readPluginConfig(value: unknown): KimiCodePluginConfig {
  if (value === undefined || value === null) {
    return DEFAULT_PLUGIN_CONFIG;
  }
  if (!isRecord(value)) {
    throw new Error("kimi-code-harness config must be an object");
  }
  const approvalPolicy = value.approvalPolicy ?? "openclaw";
  if (approvalPolicy !== "openclaw" && approvalPolicy !== "deny") {
    throw new Error("kimi-code-harness approvalPolicy must be openclaw or deny");
  }
  const approvalTimeoutMs = value.approvalTimeoutMs ?? 120_000;
  if (
    typeof approvalTimeoutMs !== "number" ||
    !Number.isFinite(approvalTimeoutMs) ||
    approvalTimeoutMs < 1_000 ||
    approvalTimeoutMs > 3_600_000
  ) {
    throw new Error("kimi-code-harness approvalTimeoutMs must be between 1000 and 3600000");
  }
  return {
    ...readOptionalPath(value, "homeDir"),
    ...readOptionalPath(value, "configPath"),
    ...readOptionalPath(value, "sdkModule"),
    approvalPolicy,
    approvalTimeoutMs,
  };
}

function readOptionalPath(
  value: Record<string, unknown>,
  key: "homeDir" | "configPath" | "sdkModule",
): Pick<KimiCodePluginConfig, typeof key> {
  const candidate = value[key];
  if (candidate === undefined) {
    return {};
  }
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    throw new Error(`kimi-code-harness ${key} must be a non-empty string`);
  }
  return { [key]: candidate.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
