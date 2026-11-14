import type {
  AgentHarnessSupport,
  AgentHarnessSupportContext,
} from "openclaw/plugin-sdk/agent-harness-runtime";

export const KIMI_CODE_HARNESS_ID = "kimi-code";
const PROVIDER_IDS = new Set(["kimi", "kimi-code", "kimi-coding"]);

export function supportsKimiCodeRoute(ctx: AgentHarnessSupportContext): AgentHarnessSupport {
  const unsupported = (reason: string): AgentHarnessSupport => ({ supported: false, reason });
  const requestedRuntime = String(ctx.requestedRuntime ?? "").trim().toLowerCase();
  if (requestedRuntime !== KIMI_CODE_HARNESS_ID) {
    return unsupported('kimi-code is explicit-only; set agentRuntime.id to "kimi-code"');
  }
  const provider = ctx.provider.trim().toLowerCase();
  if (!PROVIDER_IDS.has(provider)) {
    return unsupported(`provider "${provider || "<empty>"}" is not a Kimi Code provider route`);
  }
  if (!ctx.modelId?.trim()) {
    return unsupported("a concrete Kimi model id is required");
  }
  const providerRoute = ctx.modelProvider;
  if (providerRoute?.requestTransportOverrides === "present") {
    return unsupported("Kimi Code cannot reproduce authored OpenClaw request transport overrides");
  }
  if (providerRoute?.endpointOverrides === "present") {
    return unsupported("Kimi Code cannot reproduce authored OpenClaw endpoint overrides");
  }
  const compatibleIds = providerRoute?.runtimePolicy?.compatibleIds;
  if (
    compatibleIds !== undefined &&
    !compatibleIds.some((id) => id.trim().toLowerCase() === KIMI_CODE_HARNESS_ID)
  ) {
    return unsupported("the prepared model route does not declare kimi-code compatibility");
  }
  const preparedAuth = providerRoute?.preparedAuth;
  if (preparedAuth?.source === "profile") {
    return unsupported(
      "An explicit OpenClaw auth profile cannot be replaced by the native Kimi Code account; remove the profile pin or select the embedded runtime",
    );
  }
  return { supported: true, priority: 100 };
}
