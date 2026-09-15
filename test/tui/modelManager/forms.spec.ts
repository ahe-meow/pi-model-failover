import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../../../src/adapters/modelsJson.js";
import { ConfigStore } from "../../../src/config/configStore.js";
import { WriteQueue } from "../../../src/config/writeQueue.js";
import type {
  CatalogModel,
  ModelNode,
  ModelsJson,
  ProviderNode,
} from "../../../src/domain/types.js";
import { S } from "../../../src/strings.js";
import {
  ModelForm,
  ProviderForm,
  syncProviderAttributes,
} from "../../../src/tui/tabs/modelManager/forms.js";
import { type ModelManagerDeps, ModelManagerTab } from "../../../src/tui/tabs/modelManager.js";
import { MemoryFs } from "../../fakes/memoryFs.js";

const MODELS_PATH = "/d/models.json";
const RAW_KEY = ["sk", "live-1234567890abcd"].join("-");
const catalogModel: CatalogModel = {
  id: "m",
  name: "Catalog M",
  reasoning: false,
  vision: true,
  contextWindow: 2000,
  maxTokens: 200,
  defaults: {},
};
const providerModel = (): ModelNode => ({
  id: "m",
  name: "Old M",
  reasoning: true,
  thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: "max" },
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 9, output: 8, cacheRead: 7, cacheWrite: 6 },
  headers: { Authorization: "keep" },
  compat: { keep: true },
  unknownModel: { nested: { preserve: true } },
});
const provider = (id: string, models: ModelNode[] = [providerModel()]): ProviderNode => ({
  name: id,
  baseUrl: "https://relay.example/v1",
  api: "openai-completions",
  apiKey: RAW_KEY,
  headers: { Authorization: "header-secret", "X-Team": "keep" },
  models,
  unknownProvider: { nested: { preserve: true } },
});
const fixture = (): ModelsJson => ({
  topLevelUnknown: { preserve: true },
  providers: {
    relay: provider("Relay"),
    other: provider("Other", []),
  },
});
interface TestContext {
  deps: ModelManagerDeps;
  fs: MemoryFs;
}
async function makeDeps(
  source: ModelsJson = fixture(),
  catalog: CatalogModel[] = [catalogModel],
): Promise<TestContext> {
  const fs = new MemoryFs();
  const queue = new WriteQueue();
  fs.files.set(MODELS_PATH, `${JSON.stringify(source)}\n`);
  const config = await ConfigStore.open(fs, queue, "/d");
  if (catalog.length > 0) {
    await config.update((value) => {
      value.catalog = structuredClone(catalog);
    });
  }
  const deps: ModelManagerDeps = {
    config,
    modelsFile: new ModelsJsonFile(fs, queue, MODELS_PATH),
    initialModels: structuredClone(source),
    registrar: { syncOwned: vi.fn() },
    notify: vi.fn(),
    now: () => "2026-09-09T00:00:00.000Z",
    createKeyGroupId: () => "kg-test",
  };
  return { deps, fs };
}
interface InputTarget {
  handleInput(data: string): void | Promise<void>;
}
async function input(target: InputTarget, data: string): Promise<void> {
  await target.handleInput(data);
}
async function clearText(target: InputTarget, length: number): Promise<void> {
  for (let index = 0; index < length; index++) await input(target, Key.backspace);
}
async function submitProviderName(form: ProviderForm, name: string): Promise<void> {
  await input(form, Key.down);
  await clearText(form, "Relay".length);
  for (const character of name) await input(form, character);
  for (let index = 0; index < 6; index++) await input(form, Key.down);
  await input(form, Key.ctrl("s"));
}
async function setProviderAddValues(form: ProviderForm): Promise<void> {
  for (const character of "Added") await input(form, character);
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
async function openProviderDetail(tab: ModelManagerTab): Promise<void> {
  await input(tab, Key.enter);
}
async function confirmCurrent(target: InputTarget): Promise<void> {
  await input(target, Key.left);
  await input(target, Key.enter);
}
describe("Task 11 Model Manager forms and actions", () => {
  it("C5: syncs selected provider models in one write and preserves unknown fields", async () => {
    const { deps, fs } = await makeDeps();
    const writes = vi.spyOn(fs, "writeAtomic");
    const next = await syncProviderAttributes(deps, "relay", ["m"], deps.config.get().catalog);
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(1);
    const synced = next.providers.relay?.models[0];
    expect(synced).toMatchObject({
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 2000,
      maxTokens: 200,
    });
    expect(synced?.cost).toEqual({ input: 9, output: 8, cacheRead: 7, cacheWrite: 6 });
    expect(synced?.headers).toEqual({ Authorization: "keep" });
    expect(synced?.compat).toEqual({ keep: true });
    expect(synced?.unknownModel).toEqual({ nested: { preserve: true } });
  });
  it("syncs every provider model when no ids are selected", async () => {
    const second = { ...providerModel(), id: "second", contextWindow: 1 };
    const source = fixture();
    source.providers.relay = provider("Relay", [providerModel(), second]);
    const { deps } = await makeDeps(source, [catalogModel, { ...catalogModel, id: "second" }]);
    const next = await syncProviderAttributes(deps, "relay", [], deps.config.get().catalog);
    expect(next.providers.relay?.models.map(({ contextWindow }) => contextWindow)).toEqual([
      2000, 2000,
    ]);
  });
  it("C6: edits a provider name without leaking its API key or changing unknown fields", async () => {
    const source = fixture();
    const before = structuredClone(source.providers.relay);
    const { deps } = await makeDeps(source);
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(form.render(120, 20).join("\n")).not.toContain(RAW_KEY);
    await submitProviderName(form, "Renamed");
    const saved = await deps.modelsFile.read();
    expect(saved.providers.relay?.name).toBe("Renamed");
    expect({ ...saved.providers.relay, name: before?.name }).toEqual({
      ...before,
      name: before?.name,
    });
    expect(JSON.stringify((deps.notify as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      RAW_KEY,
    );
  });

  it("adds a validated provider with one write and parsed headers", async () => {
    const { deps, fs } = await makeDeps({ providers: {} }, []);
    const writes = vi.spyOn(fs, "writeAtomic");
    const done = vi.fn();
    const form = new ProviderForm({ ...deps, onDone: done, onCancel: vi.fn() });

    await setProviderAddValues(form);

    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(1);
    const added = (await deps.modelsFile.read()).providers.Added;
    expect(added).toMatchObject({
      name: "Added",
      baseUrl: "https://added.example/v1",
      api: "openai-completions",
      apiKey: RAW_KEY,
      headers: { "X-Team": "blue", Authorization: "auth-secret" },
      models: [],
      piModelFailover: { group: null, costMultiplier: 0.25 },
    });
    expect(done).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((deps.notify as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      RAW_KEY,
    );
  });

  it("refuses an added provider whose derived ID is already in use without writing", async () => {
    const { deps, fs } = await makeDeps();
    const writes = vi.spyOn(fs, "writeAtomic");
    const onDone = vi.fn();
    const form = new ProviderForm({ ...deps, onDone, onCancel: vi.fn() });

    for (const character of "relay") await input(form, character);
    await input(form, Key.down);
    for (const character of "https://added.example/v1") await input(form, character);
    await input(form, Key.down);
    await input(form, Key.down);
    for (const character of RAW_KEY) await input(form, character);
    await input(form, Key.down);
    await input(form, Key.down);
    for (const character of "X-Team: blue\nAuthorization: auth-secret")
      await input(form, character);
    await input(form, Key.down);
    await clearText(form, 1);
    for (const character of "0.25") await input(form, character);
    await input(form, Key.ctrl("s"));

    expect(deps.notify).toHaveBeenCalledWith(S.modelManager.providerForm.duplicateId);
    expect(onDone).not.toHaveBeenCalled();
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(0);
    const saved = await deps.modelsFile.read();
    expect(saved.providers.relay).toEqual(fixture().providers.relay);
  });

  it("edits owned provider fields while preserving unrelated provider properties", async () => {
    const { deps } = await makeDeps();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    await input(form, Key.down);
    await clearText(form, "Relay".length);
    for (const character of "Edited") await input(form, character);
    await input(form, Key.down);
    await clearText(form, "https://relay.example/v1".length);
    for (const character of "https://edited.example/v2") await input(form, character);
    for (let index = 0; index < 5; index++) await input(form, Key.down);
    await input(form, Key.ctrl("s"));

    const saved = await deps.modelsFile.read();
    expect(saved.providers.relay).toMatchObject({
      name: "Edited",
      baseUrl: "https://edited.example/v2",
      unknownProvider: { nested: { preserve: true } },
      headers: { Authorization: "header-secret", "X-Team": "keep" },
    });
    expect(saved.providers.relay?.models).toEqual(fixture().providers.relay?.models);
  });

  it("edits model fields and preserves model fields outside the form", async () => {
    const { deps } = await makeDeps();
    const done = vi.fn();
    const form = new ModelForm({
      ...deps,
      providerId: "relay",
      modelId: "m",
      onDone: done,
      onCancel: vi.fn(),
    });

    await clearText(form, "Old M".length);
    for (const character of "New M") await input(form, character);
    for (let index = 0; index < 3; index++) await input(form, Key.down);
    await clearText(form, 4);
    for (const character of "3000") await input(form, character);
    for (let index = 0; index < 5; index++) await input(form, Key.down);
    await input(form, Key.ctrl("s"));

    const saved = await deps.modelsFile.read();
    expect(saved.providers.relay?.models[0]).toMatchObject({
      name: "New M",
      contextWindow: 3000,
      cost: { input: 9, output: 8, cacheRead: 7, cacheWrite: 6 },
      unknownModel: { nested: { preserve: true } },
    });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("applies edits to the fresh Provider Model node", async () => {
    const { deps } = await makeDeps();
    const form = new ModelForm({
      ...deps,
      providerId: "relay",
      modelId: "m",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    await deps.modelsFile.update((models) => {
      const node = models.providers.relay?.models[0];
      if (node !== undefined) node.freshUnknown = { nested: { preserve: true } };
      return models;
    });
    for (let index = 0; index < 8; index++) await input(form, Key.down);
    await input(form, Key.enter);

    expect((await deps.modelsFile.read()).providers.relay?.models[0]?.freshUnknown).toEqual({
      nested: { preserve: true },
    });
  });

  it("accepts finite decimal values in all Provider Model cost fields", async () => {
    const { deps } = await makeDeps();
    const form = new ModelForm({
      ...deps,
      providerId: "relay",
      modelId: "m",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });
    for (let index = 0; index < 5; index++) await input(form, Key.down);

    const initial = [9, 8, 7, 6];
    const values = ["0.25", "1.5", "2.75", "3.125"];
    for (let index = 0; index < values.length; index++) {
      await clearText(form, String(initial[index]).length);
      for (const character of values[index] ?? "") await input(form, character);
      if (index < values.length - 1) await input(form, Key.down);
    }
    await input(form, Key.ctrl("s"));

    expect((await deps.modelsFile.read()).providers.relay?.models[0]?.cost).toEqual({
      input: 0.25,

      output: 1.5,
      cacheRead: 2.75,
      cacheWrite: 3.125,
    });
  });

  it("scrolls a focused lower form field into the fixed body", async () => {
    const { deps } = await makeDeps();
    const form = new ModelForm({
      ...deps,
      providerId: "relay",
      modelId: "m",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });
    for (let index = 0; index < 8; index++) await input(form, Key.down);

    const rendered = form.render(100, 5);
    expect(rendered).toHaveLength(6);
    expect(rendered.join("\\n")).toContain(S.modelManager.modelForm.labels.costCacheWrite);
  });

  it("creates and preserves provider multipliers", async () => {
    const { deps } = await makeDeps();
    const form = new ProviderForm({
      ...deps,
      providerId: "other",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    for (let index = 0; index < 7; index++) await input(form, Key.down);
    await clearText(form, 1);
    for (const character of "0.4") await input(form, character);
    await input(form, Key.ctrl("s"));

    expect((await deps.modelsFile.read()).providers.other?.piModelFailover).toEqual({
      group: null,

      costMultiplier: 0.4,
    });
    const relay = (await deps.modelsFile.read()).providers.relay;
    expect(relay?.piModelFailover).toBeUndefined();
  });

  it("requires confirmation for sync and writes nothing when canceled", async () => {
    const { deps, fs } = await makeDeps();
    const writes = vi.spyOn(fs, "writeAtomic");
    const tab = new ModelManagerTab(deps);

    await openProviderDetail(tab);
    await input(tab, Key.space);
    await input(tab, "s");
    expect(tab.render(120, 7).join("\n")).toContain(S.modelManager.actions.syncTitle(1));
    await input(tab, Key.escape);
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(0);

    await input(tab, "s");
    await confirmCurrent(tab);
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(1);
    expect((await deps.modelsFile.read()).providers.relay?.models[0]?.contextWindow).toBe(2000);
  });

  it("requires confirmation for removing selected models", async () => {
    const { deps, fs } = await makeDeps();
    const writes = vi.spyOn(fs, "writeAtomic");
    const tab = new ModelManagerTab(deps);

    await openProviderDetail(tab);
    await input(tab, "d");
    await input(tab, Key.escape);
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(0);

    await input(tab, "d");
    await confirmCurrent(tab);
    expect((await deps.modelsFile.read()).providers.relay?.models).toEqual([]);
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(1);
  });

  it("shows the provider ID first only when editing an existing provider", async () => {
    const { deps } = await makeDeps();
    const idLabel = S.modelManager.providerForm.labels.id;
    const edit = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });
    const add = new ProviderForm({ ...deps, onDone: vi.fn(), onCancel: vi.fn() });

    const lines = edit.render(120, 20);
    expect(lines[1]).toContain(idLabel);
    expect(lines[2]).toContain(S.modelManager.providerForm.labels.name);
    expect(add.render(120, 20).join("\n")).not.toContain(idLabel);
  });

  it("edits a provider ID, moving the key and preserving unknown fields", async () => {
    const source = fixture();
    const { deps } = await makeDeps(source);
    const onProviderIdChange = vi.fn();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onProviderIdChange,
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    await clearText(form, "relay".length);
    for (const character of "renamed") await input(form, character);
    for (let index = 0; index < 7; index++) await input(form, Key.down);
    await input(form, Key.ctrl("s"));

    const saved = await deps.modelsFile.read();
    expect(Object.keys(saved.providers)).toEqual(["renamed", "other"]);
    expect(saved.providers.renamed).toEqual(source.providers.relay);
    expect(saved.providers.relay).toBeUndefined();
    expect(onProviderIdChange).toHaveBeenCalledWith("renamed");
  });

  it("awaits the injected rename hook with the old, new, and saved provider ids", async () => {
    const { deps } = await makeDeps();
    const order: string[] = [];
    const afterProviderRename = vi.fn(
      async (_previousId: string, _providerId: string, models: ModelsJson) => {
        order.push(Object.keys(models.providers).join(","));
      },
    );
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      afterProviderRename,
      onDone: () => order.push("done"),
      onCancel: vi.fn(),
    });

    await clearText(form, "relay".length);
    for (const character of "renamed") await input(form, character);
    for (let index = 0; index < 7; index++) await input(form, Key.down);
    await input(form, Key.ctrl("s"));

    expect(afterProviderRename).toHaveBeenCalledWith("relay", "renamed", expect.anything());
    expect(order).toEqual(["renamed,other", "done"]);
  });

  it("refuses a provider ID that is already in use without writing", async () => {
    const { deps, fs } = await makeDeps();
    const writes = vi.spyOn(fs, "writeAtomic");
    const onDone = vi.fn();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone,
      onCancel: vi.fn(),
    });

    await clearText(form, "relay".length);
    for (const character of "other") await input(form, character);
    for (let index = 0; index < 7; index++) await input(form, Key.down);
    await input(form, Key.ctrl("s"));

    expect(deps.notify).toHaveBeenCalledWith(S.modelManager.providerForm.duplicateId);
    expect(onDone).not.toHaveBeenCalled();
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(0);
    const saved = await deps.modelsFile.read();
    expect(saved.providers.other?.name).toBe("Other");
    expect(saved.providers.relay).toBeDefined();
  });

  it("does not write when a provider collision appears after preflight", async () => {
    const { deps, fs } = await makeDeps();
    const writes = vi.spyOn(fs, "writeAtomic");
    const onDone = vi.fn();
    const originalRead = deps.modelsFile.read.bind(deps.modelsFile);
    const read = vi.spyOn(deps.modelsFile, "read");
    read.mockImplementationOnce(async () => {
      const current = await originalRead();
      delete current.providers.other;
      return current;
    });
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone,
      onCancel: vi.fn(),
    });

    await clearText(form, "relay".length);
    for (const character of "other") await input(form, character);
    for (let index = 0; index < 7; index++) await input(form, Key.down);
    await input(form, Key.ctrl("s"));

    expect(deps.notify).toHaveBeenCalledWith(S.modelManager.providerForm.duplicateId);
    expect(onDone).not.toHaveBeenCalled();
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(0);
    expect((await deps.modelsFile.read()).providers.relay?.name).toBe("Relay");
  });

  it.each([
    ["a slash", "bad/id"],
    ["whitespace", "bad id"],
    ["an empty value", ""],
  ])("refuses a provider ID with %s without writing", async (_label, value) => {
    const { deps, fs } = await makeDeps();
    const writes = vi.spyOn(fs, "writeAtomic");
    const onDone = vi.fn();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      onDone,
      onCancel: vi.fn(),
    });

    await clearText(form, "relay".length);
    for (const character of value) await input(form, character);
    for (let index = 0; index < 7; index++) await input(form, Key.down);
    await input(form, Key.ctrl("s"));

    expect(deps.notify).toHaveBeenCalledWith(S.modelManager.providerForm.invalidId);
    expect(onDone).not.toHaveBeenCalled();
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(0);
    expect((await deps.modelsFile.read()).providers.relay?.name).toBe("Relay");
  });

  it("exits the multiplier form with Esc after the direct edit", async () => {
    const { deps } = await makeDeps();
    const onCancel = vi.fn();
    const form = new ProviderForm({
      ...deps,
      providerId: "relay",
      mode: "multiplier",
      onDone: vi.fn(),
      onCancel,
    });
    await input(form, Key.enter);
    expect(form.isEditing()).toBe(true);
    await input(form, Key.escape);

    expect(form.isEditing()).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("C6: confirms provider deletion, removes only the provider node, and redacts notifications", async () => {
    const source = fixture();
    const { deps, fs } = await makeDeps(source);
    const writes = vi.spyOn(fs, "writeAtomic");
    const tab = new ModelManagerTab(deps);

    await input(tab, "d");
    expect(tab.render(120, 7).join("\n")).toContain(
      S.modelManager.actions.deleteProviderTitle("relay"),
    );
    await input(tab, Key.escape);
    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(0);

    await input(tab, "d");
    await confirmCurrent(tab);

    const saved = await deps.modelsFile.read();
    expect(saved.providers.relay).toBeUndefined();
    expect(saved.providers.other).toBeDefined();
    expect(saved.topLevelUnknown).toEqual({ preserve: true });
    expect(JSON.stringify((deps.notify as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      RAW_KEY,
    );
  });
});
