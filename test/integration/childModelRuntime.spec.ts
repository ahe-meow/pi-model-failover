import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  type ProviderConfig,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const providerConfig: ProviderConfig = {
  api: "pi-model-failover",
  apiKey: "unused",
  baseUrl: "https://failover.invalid",
  models: [
    {
      id: "coding",
      name: "Coding",
      api: "pi-model-failover",
      reasoning: false,
      input: ["text"],
      contextWindow: 4096,
      maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
  streamSimple: () => {
    throw new Error("routing handler should only be inspected in this test");
  },
};

describe("official child-session model runtime sharing", () => {
  it("keeps a registered failover provider available to the child runtime", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmf-child-runtime-"));
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    runtime.registerProvider("failover", providerConfig);

    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      modelRuntime: runtime,
      sessionManager: SessionManager.inMemory(dir),
      settingsManager: SettingsManager.inMemory(),
      noTools: "all",
    });
    try {
      expect(session.modelRuntime).toBe(runtime);
      expect(session.modelRuntime.getModel("failover", "coding")).toMatchObject({
        provider: "failover",
        id: "coding",
        api: "pi-model-failover",
      });
      expect(session.modelRuntime.getRegisteredProviderConfig("failover")).toMatchObject({
        api: "pi-model-failover",
        baseUrl: "https://failover.invalid",
        models: [{ id: "coding" }],
        streamSimple: expect.any(Function),
      });
    } finally {
      session.dispose();
    }
  }, 15_000);
});
