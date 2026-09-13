import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../../src/config/configStore.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { redactSecret } from "../../src/domain/redact.js";
import type { ModelNode, ModelsJson, ProviderNode } from "../../src/domain/types.js";
import { S } from "../../src/strings.js";
import { type ModelManagerDeps, ModelManagerTab } from "../../src/tui/tabs/modelManager.js";
import { MemoryFs } from "../fakes/memoryFs.js";

const LIVE_API_KEY = "fixture-key-live";
const PMM_API_KEY = "fixture-key-pmm";
const DIRECT_API_KEY = "fixture-key-direct";
const OTHER_API_KEY = "fixture-key-other";

const deterministicModelManagerCallbacks = {
  now: () => "2026-09-09T00:00:00.000Z",
  createKeyGroupId: () => "kg-test",
};

const providerModel: ModelNode = {
  id: "m",
  name: "M",
  reasoning: false,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const models: ModelsJson = {
  providers: {
    relay: {
      name: "Relay",
      baseUrl: "https://relay.example/v1",
      api: "openai-completions",
      apiKey: LIVE_API_KEY,
      models: [providerModel],
      piModelFailover: { group: "kg-1", costMultiplier: 0.1 },
    },
  },
};

async function makeDeps(source: ModelsJson): Promise<ModelManagerDeps> {
  const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
  let current = structuredClone(source);
  return {
    config,
    modelsFile: {
      read: async () => structuredClone(current),
      update: async (fn) => {
        current = fn(structuredClone(current));
        return structuredClone(current);
      },
    },
    initialModels: structuredClone(source),
    registrar: { syncOwned: vi.fn() },
    notify: vi.fn(),
    ...deterministicModelManagerCallbacks,
  };
}

function copyRelay(source: ModelsJson): ProviderNode {
  const relay = source.providers.relay;
  if (relay === undefined) throw new Error("relay fixture missing");
  return structuredClone(relay);
}

function ownershipModels(): ModelsJson {
  const source = structuredClone(models);
  const relay = copyRelay(source);
  source.providers.pmm = {
    ...relay,
    name: "PMM",
    apiKey: PMM_API_KEY,
    piModelManager: { managed: true },
  };
  delete source.providers.pmm.piModelFailover;
  source.providers.direct = {
    ...relay,
    name: "Direct",
    apiKey: DIRECT_API_KEY,
  };
  delete source.providers.direct.piModelFailover;
  delete source.providers.direct.piModelManager;
  return source;
}

describe("ModelManagerTab provider list and detail", () => {
  it("C6: renders provider ownership, multiplier, and redacted detail", async () => {
    const deps = await makeDeps(models);
    const tab = new ModelManagerTab(deps);
    const list = tab.render(78, 7).join("\n");

    expect(list).toContain("relay");
    expect(list).toContain("0.10x");
    expect(list).toContain("failover");
    expect(list).not.toContain(LIVE_API_KEY);

    tab.handleInput(Key.enter);
    const detail = tab.render(78, 7).join("\n");
    expect(detail).toContain(redactSecret(LIVE_API_KEY));
    expect(detail).toContain("m");
    expect(detail).not.toContain(LIVE_API_KEY);
  });

  it("C7: provider deletion names affected chains and invokes cleanup", async () => {
    const deps = await makeDeps(models);
    await deps.config.update((config) => {
      config.chains = [
        { id: "coding", name: "Coding", targets: [{ provider: "relay", modelId: "m" }] },
      ];
    });
    const afterProviderDelete = vi.fn(async (_providerId: string, _next: ModelsJson) => {});
    deps.afterProviderDelete = afterProviderDelete;
    const update = vi.spyOn(deps.modelsFile, "update");
    const tab = new ModelManagerTab(deps);

    await tab.handleInput("d");
    expect(tab.render(78, 7).join("\n")).toContain("Coding");
    await tab.handleInput(Key.left);
    await tab.handleInput(Key.enter);

    expect(update).toHaveBeenCalledTimes(1);
    expect(afterProviderDelete).toHaveBeenCalledWith("relay", expect.anything());
    await expect(deps.modelsFile.read()).resolves.not.toHaveProperty("providers.relay");
  });

  it("C5: marks a provider model that drifts from its catalog copy", async () => {
    const deps = await makeDeps(models);
    await deps.config.update((config) => {
      config.catalog.push({
        id: "m",
        reasoning: true,
        vision: false,
        contextWindow: 2000,
        maxTokens: 200,
        defaults: {},
      });
    });
    const tab = new ModelManagerTab(deps);

    tab.handleInput(Key.enter);

    expect(tab.render(78, 7).join("\n")).toContain("~");
  });

  it("labels failover, PMM, and unowned providers separately", async () => {
    const tab = new ModelManagerTab(await makeDeps(ownershipModels()));
    const lines = tab.render(100, 7);
    const relay = lines.find((line) => line.includes("relay")) ?? "";
    const pmm = lines.find((line) => line.includes("pmm")) ?? "";
    const direct = lines.find((line) => line.includes("direct")) ?? "";

    expect(relay).toContain("failover");
    expect(pmm).toContain("pmm");
    expect(direct).not.toContain("failover");
    expect(direct).not.toContain("pmm");
  });

  it("keeps the list and detail data area exactly listRows lines", async () => {
    for (const listRows of [5, 7, 20]) {
      const tab = new ModelManagerTab(await makeDeps(models));
      expect(tab.render(78, listRows)).toHaveLength(listRows + 1);

      tab.handleInput(Key.enter);
      expect(tab.render(78, listRows)).toHaveLength(listRows + 1);
    }
  });

  it("moves provider selection and opens the selected provider", async () => {
    const source = structuredClone(models);
    const relay = copyRelay(source);
    source.providers.other = {
      ...relay,
      name: "Other",
      apiKey: OTHER_API_KEY,
      models: [{ ...providerModel, id: "other-model" }],
    };
    const tab = new ModelManagerTab(await makeDeps(source));

    tab.handleInput(Key.down);
    const list = tab.render(78, 7).join("\n");
    expect(list).toContain("\x1b[7mother");

    tab.handleInput(Key.enter);
    const detail = tab.render(78, 7).join("\n");
    expect(detail).toContain("other");
    expect(detail).toContain("other-model");
  });

  it("resolves rename and multiplier actions from the current list selection after detail", async () => {
    const source = structuredClone(models);
    const relay = copyRelay(source);
    source.providers.other = {
      ...relay,
      name: "Other",
      apiKey: OTHER_API_KEY,
      models: [{ ...providerModel, id: "other-model" }],
      piModelFailover: { group: "kg-other", costMultiplier: 1 },
    };
    const deps = await makeDeps(source);
    const tab = new ModelManagerTab(deps);

    await tab.handleInput(Key.enter);
    await tab.handleInput(Key.escape);
    await tab.handleInput(Key.down);
    await tab.handleInput("r");
    for (let index = 0; index < "Other".length; index++) await tab.handleInput(Key.backspace);
    for (const character of "Renamed") await tab.handleInput(character);
    await tab.handleInput(Key.enter);

    await tab.handleInput("m");
    for (let index = 0; index < "0.1".length; index++) await tab.handleInput(Key.backspace);
    for (const character of "0.25") await tab.handleInput(character);
    await tab.handleInput(Key.enter);

    const saved = await deps.modelsFile.read();
    expect(saved.providers.relay?.name).toBe("Relay");
    expect(saved.providers.other?.name).toBe("Renamed");
    expect(saved.providers.relay?.piModelFailover?.costMultiplier).toBe(0.1);
    expect(saved.providers.other?.piModelFailover?.costMultiplier).toBe(0.25);
  });

  it("Esc returns from provider detail to the provider list", async () => {
    const tab = new ModelManagerTab(await makeDeps(models));
    tab.handleInput(Key.enter);
    const detail = tab.render(78, 7).join("\n");
    expect(detail).toContain("https://relay.example/v1");

    tab.handleInput(Key.escape);
    const list = tab.render(78, 7).join("\n");
    expect(list).toContain("relay");
    expect(list).not.toContain("https://relay.example/v1");
  });

  it("opens an add provider form after leaving provider detail", async () => {
    const tab = new ModelManagerTab(await makeDeps(models));

    tab.handleInput(Key.enter);
    tab.handleInput(Key.escape);
    tab.handleInput("a");

    const form = tab.render(78, 7).join("\n");
    expect(form).toContain(S.modelManager.providerForm.addTitle);
    expect(form).not.toContain(S.modelManager.providerForm.editTitle);
    expect(form).not.toContain("Relay");
    expect(form).not.toContain("https://relay.example/v1");
  });

  it("never renders a raw API key in either provider screen", async () => {
    const tab = new ModelManagerTab(await makeDeps(models));
    const rawKey = LIVE_API_KEY;

    for (const listRows of [5, 7, 20]) {
      expect(tab.render(78, listRows).join("\n")).not.toContain(rawKey);
      tab.handleInput(Key.enter);
      expect(tab.render(78, listRows).join("\n")).not.toContain(rawKey);
      tab.handleInput(Key.escape);
    }
  });

  it("refreshes the in-memory provider snapshot", async () => {
    const tab = new ModelManagerTab(await makeDeps(models));
    const next = structuredClone(models);
    next.providers.updated = copyRelay(next);
    delete next.providers.relay;

    tab.refresh(next);

    expect(tab.render(78, 7).join("\n")).toContain("updated");
  });

  it("accepts later list hooks without breaking input handling", async () => {
    const tab = new ModelManagerTab(await makeDeps(models));

    expect(() => tab.handleInput("k")).not.toThrow();
    expect(() => tab.handleInput("c")).not.toThrow();
    expect(() => tab.handleInput(Key.home)).not.toThrow();
    expect(() => tab.handleInput(Key.end)).not.toThrow();
  });
});
