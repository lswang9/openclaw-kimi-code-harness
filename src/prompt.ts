import {
  buildTemporalContextText,
  detectAndLoadAgentHarnessPromptImages,
  type EmbeddedRunAttemptParamsV2,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import type { KimiPromptPart } from "./kimi-sdk.js";

export async function buildKimiPrompt(
  params: EmbeddedRunAttemptParamsV2,
  workspaceDir: string,
): Promise<readonly KimiPromptPart[]> {
  const loaded = await detectAndLoadAgentHarnessPromptImages({
    prompt: params.prompt,
    workspaceDir,
    agentWorkspaceDir: params.workspaceDir,
    model: { input: params.model.input ?? ["text", "image"] },
    ...(params.images ? { existingImages: params.images } : {}),
    ...(params.imageOrder ? { imageOrder: params.imageOrder } : {}),
    ...(params.media ? { media: params.media } : {}),
    ...(params.config ? { config: params.config } : {}),
    ...(params.userTurnTranscriptRecorder
      ? { userTurnTranscriptRecorder: params.userTurnTranscriptRecorder }
      : {}),
  });
  const temporal = buildTemporalContextText({
    ...(params.config?.agents?.defaults?.userTimezone
      ? { configuredTimezone: params.config.agents.defaults.userTimezone }
      : {}),
    sessionStatusAvailable: false,
  });
  const context = params.currentInboundContext?.text.trim();
  const prompt = [
    params.extraSystemPrompt?.trim(),
    context,
    temporal,
    params.prompt,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(params.currentInboundContext?.promptJoiner ?? "\n\n");
  if (!prompt.trim()) {
    throw new Error("Kimi Code prompt cannot be empty");
  }
  return [
    { type: "text", text: prompt },
    ...loaded.images.map((image) => ({
      type: "image_url" as const,
      imageUrl: { url: `data:${image.mimeType};base64,${image.data}` },
    })),
  ];
}
