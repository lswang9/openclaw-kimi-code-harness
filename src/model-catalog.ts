import type { KimiHarness } from "./kimi-sdk.js";

export async function loadKimiNativeModelCatalog(nativeHarness: KimiHarness) {
  const config = await nativeHarness.getConfig();
  const entries = new Map<string, {
    provider: string;
    id: string;
    name: string;
    nativeRuntime: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    contextWindow: number;
  }>();
  for (const [alias, model] of Object.entries(config.models ?? {})) {
    const id = model.model.trim() || alias.split("/").at(-1)?.trim();
    if (!id) {
      continue;
    }
    const existing = entries.get(id);
    const preferred = config.defaultModel === alias;
    if (existing && !preferred) {
      continue;
    }
    entries.set(id, {
      provider: "kimi",
      id,
      name: model.displayName?.trim() || id,
      nativeRuntime: "kimi-code",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: model.maxContextSize,
    });
  }
  return [...entries.values()];
}
