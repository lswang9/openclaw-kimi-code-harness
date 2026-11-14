import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { readPluginConfig } from "./config.js";
import { createKimiCodeAgentHarness } from "./harness.js";
import type { SessionBinding, SessionBindingStore } from "./session-binding.js";

export default definePluginEntry({
  id: "kimi-code-harness",
  name: "Kimi Code Agent Harness",
  description: "Runs explicitly selected OpenClaw turns in the official Kimi Code native runtime.",
  register(api) {
    if (
      api.registrationMode !== "full" &&
      api.registrationMode !== "discovery" &&
      api.registrationMode !== "tool-discovery"
    ) {
      return;
    }
    const config = readPluginConfig(api.pluginConfig);
    let store: SessionBindingStore | undefined;
    const sessionStore = {
      lookup: async (key: string) => getStore().lookup(key),
      register: async (key: string, value: SessionBinding) => getStore().register(key, value),
      delete: async (key: string) => getStore().delete(key),
    };
    const getStore = () =>
      (store ??= api.runtime.state.openKeyedStore<SessionBinding>({
        namespace: "native-sessions",
        maxEntries: 5000,
        defaultTtlMs: 180 * 24 * 60 * 60 * 1000,
      }));
    api.registerAgentHarness(
      createKimiCodeAgentHarness({
        config,
        sessionStore,
        logger: api.logger,
      }),
    );
  },
});
