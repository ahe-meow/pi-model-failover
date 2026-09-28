import { describe, expect, it } from "vitest";
import {
  listProviders,
  providersWithModel,
  syncFailoverVirtualModels,
} from "../../src/domain/providers.js";
import type { ModelNode, ModelsJson, ProviderNode } from "../../src/domain/types.js";

const virtualModel = {
  id: "coding",
  name: "Coding",
  api: "pi-model-failover",
  reasoning: false,
  input: ["text"],
  contextWindow: 4096,
  maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as unknown as ModelNode;

const ordinaryProvider: ProviderNode = {
  name: "Relay",
  api: "openai-completions",
  baseUrl: "https://relay.example/v1",
  models: [{ ...virtualModel, id: "coding", api: "openai-completions" }],
  customField: { keep: true },
};

describe("persisted failover virtual model catalog", () => {
  it("writes the reserved provider catalog without runtime credentials and preserves unrelated data", () => {
    const models: ModelsJson = {
      unknownRoot: { keep: true },
      providers: {
        relay: ordinaryProvider,
        failover: {
          name: "Failover",
          api: "pi-model-failover",
          models: [virtualModel],
          piModelFailoverVirtual: true,
          unknownProvider: { keep: true },
        } as unknown as ProviderNode,
      },
    };

    const sensitiveModel = {
      ...virtualModel,
      unknownModel: { keep: true },
      apiKey: "model-secret",
      headers: { authorization: "model-secret" },
    } as unknown as ModelNode;
    const next = syncFailoverVirtualModels(models, [sensitiveModel]);

    expect(next.providers.failover).toMatchObject({
      name: "Failover",
      api: "pi-model-failover",
      models: [virtualModel],
      piModelFailoverVirtual: true,
      unknownProvider: { keep: true },
    });
    expect(next.providers.failover).not.toHaveProperty("apiKey");
    expect(next.providers.failover).not.toHaveProperty("baseUrl");
    expect(next.providers.failover).not.toHaveProperty("headers");
    expect(JSON.stringify(next.providers.failover)).not.toContain("model-secret");
    expect(next.providers.failover?.models[0]?.unknownModel).toEqual({ keep: true });
    expect(next.providers.relay).toEqual(ordinaryProvider);
    expect(next.unknownRoot).toEqual({ keep: true });
  });

  it("removes only the extension-owned virtual provider when the catalog becomes empty", () => {
    const models: ModelsJson = {
      providers: {
        relay: ordinaryProvider,
        failover: {
          name: "Failover",
          api: "pi-model-failover",
          models: [virtualModel],
          piModelFailoverVirtual: true,
        } as unknown as ProviderNode,
      },
    };

    const next = syncFailoverVirtualModels(models, []);

    expect(next.providers).toEqual({ relay: ordinaryProvider });
    expect(models.providers.failover).toBeDefined();
  });

  it("leaves an unmarked failover provider untouched when the catalog becomes empty", () => {
    const userProvider: ProviderNode = {
      name: "User failover",
      api: "openai-completions",
      baseUrl: "https://user.example/v1",
      models: [],
    };
    const next = syncFailoverVirtualModels({ providers: { failover: userProvider } }, []);

    expect(next.providers.failover).toEqual(userProvider);
  });

  it("keeps virtual models out of provider and Chain target discovery", () => {
    const models = syncFailoverVirtualModels({ providers: { relay: ordinaryProvider } }, [
      virtualModel,
    ]);

    expect(listProviders(models).map(({ id }) => id)).toEqual(["relay"]);
    expect(providersWithModel(models, "coding")).toEqual(["relay"]);
  });
});
