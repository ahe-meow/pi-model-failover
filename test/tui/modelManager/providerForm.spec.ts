import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../../../src/adapters/modelsJson.js";
import { ConfigStore } from "../../../src/config/configStore.js";
import { WriteQueue } from "../../../src/config/writeQueue.js";
import type { ModelsJson, ProviderNode } from "../../../src/domain/types.js";
import { S } from "../../../src/strings.js";
import { ProviderForm } from "../../../src/tui/tabs/modelManager/forms.js";
import type { ModelManagerDeps } from "../../../src/tui/tabs/modelManager.js";
import { MemoryFs } from "../../fakes/memoryFs.js";

const MODELS_PATH = "/d/models.json";
const RAW_KEY = ["sk", "live-1234567890abcd"].join("-");
const provider = (name: string): ProviderNode => ({
  name,
  baseUrl: "https://relay.example/v1",
  api: "openai-completions",
  apiKey: RAW_KEY,
  models: [],
});
const source = (): ModelsJson => ({ providers: { relay: provider("Relay") } });

interface InputTarget {
  handleInput(data: string): void | Promise<void>;
}
interface TestContext {
  deps: ModelManagerDeps;
}
async function input(target: InputTarget, data: string): Promise<void> {
  await target.handleInput(data);
}
async function clearText(target: InputTarget, length: number): Promise<void> {
  for (let index = 0; index < length; index++) await input(target, Key.backspace);
}
async function makeDeps(models: ModelsJson = source()): Promise<TestContext> {
  const fs = new MemoryFs();
  const queue = new WriteQueue();
  fs.files.set(MODELS_PATH, `${JSON.stringify(models)}\n`);
  const config = await ConfigStore.open(fs, queue, "/d");
  return {
    deps: {
      config,
      modelsFile: new ModelsJsonFile(fs, queue, MODELS_PATH),
      initialModels: structuredClone(models),
      registrar: { syncOwned: vi.fn() },
      notify: vi.fn(),
      now: () => "2026-09-09T00:00:00.000Z",
      createKeyGroupId: () => "kg-test",
    },
  };
}
async function submitProviderName(form: ProviderForm, name: string): Promise<void> {
  await input(form, Key.down);
  await clearText(form, "Relay".length);
  for (const character of name) await input(form, character);
  for (let index = 0; index < 6; index++) await input(form, Key.down);
  await input(form, Key.ctrl("s"));
}
async function setProviderAddValues(form: ProviderForm, name: string): Promise<void> {
  for (const character of name) await input(form, character);
  await input(form, Key.down);
  for (const character of "https://added.example/v1") await input(form, character);
  await input(form, Key.down);
  await input(form, Key.down);
  for (const character of RAW_KEY) await input(form, character);
  await input(form, Key.down);
  await input(form, Key.down);
  for (const character of "X-Team: blue\nAuthorization: auth-secret") await input(form, character);
  await input(form, Key.down);
  await clearText(form, 1);
  for (const character of "0.25") await input(form, character);
  await input(form, Key.ctrl("s"));
}

describe("ProviderForm name normalization", () => {
  it("uses the Provider ID when an edited Provider name is empty", async () => {
    const { deps } = await makeDeps();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    await submitProviderName(form, "");

    expect((await deps.modelsFile.read()).providers.relay?.name).toBe("relay");
  });

  it("normalizes illegal characters when renaming a Provider", async () => {
    const { deps } = await makeDeps();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      mode: "rename",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    await clearText(form, "Relay".length);
    for (const character of "Bad Name/One") await input(form, character);
    await input(form, Key.ctrl("s"));

    expect((await deps.modelsFile.read()).providers.relay?.name).toBe("Bad-Name-One");
  });

  it("trims a non-empty Provider name before saving", async () => {
    const { deps } = await makeDeps();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      mode: "rename",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    await clearText(form, "Relay".length);
    for (const character of "  Renamed  ") await input(form, character);
    await input(form, Key.ctrl("s"));

    expect((await deps.modelsFile.read()).providers.relay?.name).toBe("Renamed");
  });

  it("trims a Provider name during a full edit", async () => {
    const { deps } = await makeDeps();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    await submitProviderName(form, "  Renamed  ");

    expect((await deps.modelsFile.read()).providers.relay?.name).toBe("Renamed");
  });

  it("keeps Provider ID validation strict instead of normalizing the ID", async () => {
    const { deps } = await makeDeps();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    await clearText(form, "relay".length);
    for (const character of "bad/id") await input(form, character);
    for (let index = 0; index < 7; index++) await input(form, Key.down);
    await input(form, Key.ctrl("s"));

    expect(deps.notify).toHaveBeenCalledWith(S.modelManager.providerForm.invalidId);
    expect((await deps.modelsFile.read()).providers.relay).toBeDefined();
    expect((await deps.modelsFile.read()).providers["bad-id"]).toBeUndefined();
  });

  it("saves a provider when another Pi provider defines API and URL per model", async () => {
    const models = source();
    models.providers.scoped = {
      name: "Model-scoped",
      models: [
        {
          id: "m",
          api: "openai-responses",
          baseUrl: "https://scoped.example/v1",
          reasoning: false,
          input: ["text"],
          contextWindow: 1000,
          maxTokens: 100,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    };
    const { deps } = await makeDeps(models);
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    await submitProviderName(form, "Renamed");

    const saved = await deps.modelsFile.read();
    expect(saved.providers.relay?.name).toBe("Renamed");
    expect(deps.notify).not.toHaveBeenCalled();
    expect(saved.providers.scoped?.api).toBeUndefined();
    expect(saved.providers.scoped?.baseUrl).toBeUndefined();
    expect(saved.providers.scoped?.models[0]).toMatchObject({
      api: "openai-responses",
      baseUrl: "https://scoped.example/v1",
    });
  });

  it("adds a provider with an illegal name normalized to hyphens", async () => {
    const { deps } = await makeDeps({ providers: {} });
    const form = new ProviderForm({ ...deps, onDone: vi.fn(), onCancel: vi.fn() });

    await setProviderAddValues(form, "  Bad Name/One  ");

    const saved = await deps.modelsFile.read();
    expect(saved.providers["Bad-Name-One"]?.name).toBe("Bad-Name-One");
  });
});
