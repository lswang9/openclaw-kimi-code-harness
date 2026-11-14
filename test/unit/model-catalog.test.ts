import { describe, expect, it } from "vitest";
import { loadKimiNativeModelCatalog } from "../../src/model-catalog.js";
import { FakeKimiBackend } from "../helpers/fake-kimi.js";

describe("native model catalog", () => {
  it("publishes Kimi models as owned by the kimi-code harness", async () => {
    const backend = new FakeKimiBackend();
    const native = backend.module().createKimiHarness({
      identity: { productName: "test", version: "1", platform: "test" },
      uiMode: "test",
    });
    expect(await loadKimiNativeModelCatalog(native)).toEqual([
      expect.objectContaining({
        provider: "kimi",
        id: "kimi-for-coding",
        nativeRuntime: "kimi-code",
      }),
    ]);
  });
});
