import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ModelsJsonFile } from "../../src/adapters/modelsJson.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { virtualModelNode } from "../../src/domain/chains.js";
import type { ModelNode, ProviderNode } from "../../src/domain/types.js";
import { normalizeThinkingLevelMap } from "../../src/domain/types.js";
import { toPiProviderConfig } from "../../src/index.js";
import { MemoryFs } from "../fakes/memoryFs.js";

const path = "/agent/models.json";
const fullMap: Record<string, string | null> = {
  off: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};
const expectedLevels = ["off", "low", "medium", "high", "xhigh", "max"];

const model = (id: string, overrides: Partial<ModelNode> = {}): ModelNode => ({
  id,
  name: id,
  reasoning: true,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  ...overrides,
});

const provider = (...models: ModelNode[]): ProviderNode => ({
  name: "relay",
  baseUrl: "https://relay.example/v1",
  api: "openai-completions",
  models,
});

const piModel = (thinkingLevelMap: Record<string, string | null>): Model<"openai-completions"> => ({
  id: "m",
  name: "m",
  api: "openai-completions",
  provider: "relay",
  baseUrl: "https://relay.example/v1",
  reasoning: true,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  thinkingLevelMap,
});

const expectSixLevels = (thinkingLevelMap: Record<string, string | null> | undefined): void => {
  expect(thinkingLevelMap?.minimal).toBeNull();
  expect(getSupportedThinkingLevels(piModel(thinkingLevelMap ?? {}))).toEqual(expectedLevels);
};

describe("reasoning capability normalization", () => {
  it("carries minimal null through every model normalization boundary", async () => {
    const legacy = normalizeThinkingLevelMap(true, fullMap);
    const explicitNull = normalizeThinkingLevelMap(true, { ...fullMap, minimal: null });
    expect(legacy).toEqual({ ...fullMap, minimal: null });
    expect(explicitNull).toEqual({ ...fullMap, minimal: null });
    expectSixLevels(legacy);
    expectSixLevels(explicitNull);
    expectSixLevels(normalizeThinkingLevelMap(true));
    expect(normalizeThinkingLevelMap(false, { minimal: "minimal", high: "high" })).toEqual({
      minimal: "minimal",
      high: "high",
    });

    const fs = new MemoryFs();
    fs.files.set(
      path,
      JSON.stringify({
        providers: {
          relay: provider(
            model("default"),
            model("legacy", { thinkingLevelMap: fullMap }),
            model("explicit-null", { thinkingLevelMap: { ...fullMap, minimal: null } }),
            model("non-reasoning", {
              reasoning: false,
              thinkingLevelMap: { minimal: "minimal", high: "high" },
            }),
          ),
        },
      }),
    );
    const persisted = await new ModelsJsonFile(fs, new WriteQueue(), path).read();
    const persistedModels = persisted.providers.relay?.models ?? [];
    expectSixLevels(persistedModels[0]?.thinkingLevelMap);
    expectSixLevels(persistedModels[1]?.thinkingLevelMap);
    expectSixLevels(persistedModels[2]?.thinkingLevelMap);
    expect(persistedModels[3]?.thinkingLevelMap).toEqual({
      minimal: "minimal",
      high: "high",
    });

    const projected = virtualModelNode(
      { id: "coding", name: "Coding", targets: [{ provider: "relay", modelId: "legacy" }] },
      { providers: { relay: provider(model("legacy", { thinkingLevelMap: fullMap })) } },
    );
    expectSixLevels(projected?.thinkingLevelMap);

    const piConfig = toPiProviderConfig({
      name: "relay",
      models: [model("legacy", { thinkingLevelMap: fullMap }), model("default")],
    });
    const configuredModels = piConfig.models ?? [];
    expectSixLevels(configuredModels[0]?.thinkingLevelMap);
    expectSixLevels(configuredModels[1]?.thinkingLevelMap);
  });
});
