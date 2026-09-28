import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../src/adapters/modelsJson.js";
import { nodeFs } from "../src/adapters/nodeFs.js";
import { ConfigStore } from "../src/config/configStore.js";
import { WriteQueue } from "../src/config/writeQueue.js";
import type { Chain, ModelNode, ProviderNode } from "../src/domain/types.js";
import { FakePi } from "./fakes/fakePi.js";

const runtimeMock = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  getAgentDir: () => runtimeMock.agentDir,
  ModelRuntime: { create: vi.fn(async () => ({ getModels: () => [] })) },
}));

const realModel: ModelNode = {
  id: "real-model",
  name: "Real model",
  api: "openai-completions",
  baseUrl: "https://relay.example/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 8192,
  maxTokens: 1024,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
};
const chain: Chain = {
  id: "coding",
  name: "Coding",
  targets: [{ provider: "relay", modelId: "real-model" }],
};
const relay: ProviderNode = {
  name: "Relay",
  api: "openai-completions",
  baseUrl: "https://relay.example/v1",
  apiKey: "source-provider-secret",
  models: [realModel],
};

describe("failover catalog restart", () => {
  it("persists the catalog and restores the routing handler in a fresh extension host", async () => {
    runtimeMock.agentDir = mkdtempSync(join(tmpdir(), "pmf-restart-"));
    const dir = runtimeMock.agentDir;
    const modelsPath = join(dir, "models.json");
    const configDir = join(dir, "pi-model-failover");
    await nodeFs.mkdir(configDir, 0o700);

    const modelsFile = new ModelsJsonFile(nodeFs, new WriteQueue(), modelsPath);
    await modelsFile.update(() => ({ providers: { relay } }));
    const config = await ConfigStore.open(nodeFs, new WriteQueue(), configDir);
    await config.update((value) => {
      value.chains = [chain];
    });

    const { default: extension } = await import("../src/index.js");
    const firstHost = new FakePi();
    await extension(firstHost as never);

    const catalog = await modelsFile.read();
    expect(catalog.providers.failover).toMatchObject({
      api: "pi-model-failover",
      piModelFailoverVirtual: true,
      models: [{ id: "coding", api: "pi-model-failover" }],
    });
    expect(catalog.providers.failover).not.toHaveProperty("apiKey");
    expect(JSON.stringify(catalog.providers.failover)).not.toContain("source-provider-secret");
    expect(JSON.stringify(catalog.providers.failover)).not.toContain('"unused"');

    const secondHost = new FakePi();
    await extension(secondHost as never);

    const restored = secondHost.providers.get("failover") as {
      models?: unknown[];
      streamSimple?: unknown;
    };
    expect(restored.models).toMatchObject([{ id: "coding" }]);
    expect(restored.streamSimple).toEqual(expect.any(Function));

    await config.update((value) => {
      value.chains = [];
    });
    const thirdHost = new FakePi();
    await extension(thirdHost as never);

    const cleared = await modelsFile.read();
    expect(cleared.providers.failover).toBeUndefined();
    expect(thirdHost.providers.has("failover")).toBe(false);
  }, 15_000);
});
