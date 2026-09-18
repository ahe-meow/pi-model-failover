import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../../../src/adapters/modelsJson.js";
import { ConfigStore } from "../../../src/config/configStore.js";
import { WriteQueue } from "../../../src/config/writeQueue.js";
import { CATALOG_DEFAULTS } from "../../../src/domain/catalog.js";
import type { Fetch } from "../../../src/domain/ports.js";
import type {
  CatalogModel,
  ModelNode,
  ModelsJson,
  ProviderNode,
} from "../../../src/domain/types.js";
import { S } from "../../../src/strings.js";
import {
  CatalogScreen,
  type CatalogScreenDeps,
} from "../../../src/tui/tabs/modelManager/catalogScreen.js";
import { MemoryFs } from "../../fakes/memoryFs.js";

const MODELS_PATH = "/d/models.json";
const CONFIG_PATH = "/d/config.json";
const RELAY_API_KEY = ["sk", "relay-secret-1234"].join("-");
const ENDPOINT_API_KEY = ["sk", "endpoint-secret-1234"].join("-");
const FAILURE_SECRET = ["sk", "failure-secret-1234"].join("-");

const model = (id: string): ModelNode => ({
  id,
  reasoning: false,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

const provider = (id: string, key = RELAY_API_KEY): ProviderNode => ({
  name: id,
  baseUrl: "https://relay.example/v1",
  api: "openai-completions",
  apiKey: key,
  headers: { "X-Team": "blue" },
  models: [],
});

const catalogModel = (id: string): CatalogModel => ({
  id,
  reasoning: false,
  vision: false,
  contextWindow: 1000,
  maxTokens: 100,
  defaults: { temperature: 0.2 },
});

const emptyModels: ModelsJson = { providers: { relay: provider("relay") } };

interface MakeDepsOptions {
  fs?: MemoryFs;
  config?: ConfigStore;
  models?: ModelsJson;
  catalog?: CatalogModel[];
  fetch?: Fetch;
  runtimeFactory?: CatalogScreenDeps["runtimeFactory"];
}

interface TestContext {
  deps: CatalogScreenDeps;
  fs: MemoryFs;
}

async function makeDeps(options: MakeDepsOptions = {}): Promise<TestContext> {
  const fs = options.fs ?? new MemoryFs();
  const queue = new WriteQueue();
  const initialModels = structuredClone(options.models ?? emptyModels);
  fs.files.set(MODELS_PATH, `${JSON.stringify(initialModels)}\n`);
  const config = options.config ?? (await ConfigStore.open(fs, queue, "/d"));
  const catalog = options.catalog;
  if (catalog !== undefined) {
    await config.update((value) => {
      value.catalog = structuredClone(catalog);
    });
  }
  const modelsFile = new ModelsJsonFile(fs, queue, MODELS_PATH);
  return {
    fs,
    deps: {
      config,
      modelsFile,
      initialModels,
      registrar: { syncOwned: vi.fn() },
      notify: vi.fn(),
      now: () => "2026-09-09T00:00:00.000Z",
      createKeyGroupId: () => "kg-test",
      fetch:
        options.fetch ??
        (vi.fn(
          async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
        ) as unknown as Fetch),
      runtimeFactory:
        options.runtimeFactory ??
        (vi.fn(async () => ({ getModels: () => [] })) as CatalogScreenDeps["runtimeFactory"]),
      onDone: vi.fn(),
    },
  };
}

interface InputTarget {
  handleInput(data: string): void | Promise<void>;
}

async function input(target: InputTarget, data: string): Promise<void> {
  await target.handleInput(data);
}

async function markIndices(target: InputTarget, indices: number[]): Promise<void> {
  let selected = 0;
  for (const index of indices) {
    while (selected < index) {
      await input(target, Key.down);
      selected += 1;
    }
    await input(target, Key.space);
  }
}

async function markAllProviders(target: InputTarget): Promise<void> {
  await input(target, "a");
}

async function confirm(target: InputTarget): Promise<void> {
  await input(target, Key.left);
  await input(target, Key.enter);
}

async function submitManualId(target: InputTarget, id: string): Promise<void> {
  await input(target, "+");
  for (const character of id) await input(target, character);
  for (let index = 0; index < 5; index++) await input(target, Key.down);
  await input(target, Key.enter);
  await input(target, Key.ctrl("s"));
}

describe("CatalogScreen", () => {
  it("C2: imports fifty endpoint ids and confirms ten in one config update", async () => {
    const ids = Array.from({ length: 50 }, (_, index) => `m-${index}`);
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const update = vi.spyOn(config, "update");
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 }),
    ) as unknown as Fetch;
    const { deps } = await makeDeps({ config, fetch });
    const screen = new CatalogScreen(deps);

    await screen.beginEndpointImport("relay");
    await markIndices(
      screen,
      Array.from({ length: 10 }, (_, index) => index),
    );
    await confirm(screen);

    expect(update).toHaveBeenCalledTimes(1);
    expect(config.get().catalog).toHaveLength(10);
    expect(config.get().catalog.map(({ id }) => id)).toEqual(ids.slice(0, 10));
  });

  it("C3: imports built-in catalog offline without calling fetch", async () => {
    const fetch = vi.fn() as unknown as Fetch;
    const runtimeFactory = vi.fn(async () => ({
      getModels: () => [
        { id: "gpt", contextWindow: 1000, maxTokens: 100 },
        { id: "claude", contextWindow: 2000, maxTokens: 200 },
      ],
    }));
    const { deps } = await makeDeps({ fetch, runtimeFactory });
    const screen = new CatalogScreen(deps);

    await input(screen, "p");

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.render(100, 7).join("\n")).toContain("gpt");
  });

  it("C4: adds one catalog model to five providers with one models write", async () => {
    const fs = new MemoryFs();
    const models: ModelsJson = {
      providers: Object.fromEntries(
        Array.from({ length: 5 }, (_, index) => [`p${index + 1}`, provider(`p${index + 1}`, "")]),
      ),
    };
    const { deps } = await makeDeps({ fs, models, catalog: [catalogModel("m")] });
    const writes = vi.spyOn(fs, "writeAtomic");
    const screen = new CatalogScreen(deps);

    await screen.beginProviderAdd("m");
    await markAllProviders(screen);
    await confirm(screen);

    expect(writes.mock.calls.filter(([path]) => path === MODELS_PATH)).toHaveLength(1);
    const saved = await deps.modelsFile.read();
    expect(
      Object.values(saved.providers).every((entry) => entry.models.some(({ id }) => id === "m")),
    ).toBe(true);
    expect(deps.onDone).toHaveBeenCalledTimes(1);
  });

  it("replaces a catalog id through the manual add form using catalog defaults", async () => {
    const existing = { ...catalogModel("m"), reasoning: false, contextWindow: 1 };
    const { deps } = await makeDeps({ catalog: [existing] });
    const update = vi.spyOn(deps.config, "update");
    const screen = new CatalogScreen(deps);

    await submitManualId(screen, "m");

    expect(update).toHaveBeenCalledTimes(1);
    expect(deps.config.get().catalog).toEqual([{ id: "m", ...CATALOG_DEFAULTS }]);
  });

  it("opens the editor and backs out without changing the catalog", async () => {
    const { deps } = await makeDeps({ catalog: [catalogModel("m")] });
    const update = vi.spyOn(deps.config, "update");
    const screen = new CatalogScreen(deps);

    await input(screen, "e");
    expect(screen.render(100, 7).join("\n")).toContain(S.modelManager.catalog.manualTitle);
    await input(screen, Key.escape);

    expect(update).not.toHaveBeenCalled();
    expect(screen.render(100, 7).join("\n")).toContain(S.modelManager.catalog.header(1));
  });

  it("deletes catalog models after confirmation without deleting Provider Models", async () => {
    const models: ModelsJson = {
      providers: { relay: { ...provider("relay"), models: [model("m")] } },
    };
    const { deps, fs } = await makeDeps({ models, catalog: [catalogModel("m")] });
    const configUpdate = vi.spyOn(deps.config, "update");
    const modelsUpdate = vi.spyOn(deps.modelsFile, "update");
    const writesBefore = fs.files.get(CONFIG_PATH);
    const screen = new CatalogScreen(deps);

    await input(screen, "d");
    expect(screen.render(100, 7).join("\n")).toContain(S.modelManager.catalog.deleteTitle(1));
    await input(screen, Key.escape);
    expect(configUpdate).not.toHaveBeenCalled();
    expect(modelsUpdate).not.toHaveBeenCalled();
    expect(fs.files.get(CONFIG_PATH)).toBe(writesBefore);

    await input(screen, "d");
    await confirm(screen);

    expect(configUpdate).toHaveBeenCalledTimes(1);
    expect(modelsUpdate).not.toHaveBeenCalled();
    expect(deps.config.get().catalog).toEqual([]);
    expect((await deps.modelsFile.read()).providers.relay?.models).toEqual([model("m")]);
  });

  it("does not write for an empty selection or a canceled provider add", async () => {
    const { deps, fs } = await makeDeps({ catalog: [catalogModel("m")] });
    const configUpdate = vi.spyOn(deps.config, "update");
    const modelsUpdate = vi.spyOn(deps.modelsFile, "update");
    const before = fs.files.get(MODELS_PATH);
    const screen = new CatalogScreen(deps);

    await screen.beginEndpointImport("relay");
    await input(screen, Key.enter);
    expect(configUpdate).not.toHaveBeenCalled();

    await screen.beginProviderAdd("m");
    await input(screen, Key.escape);

    expect(modelsUpdate).not.toHaveBeenCalled();
    expect(fs.files.get(MODELS_PATH)).toBe(before);
  });

  it("does not import an endpoint when its provider selection is cleared", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: "unused" }] }), { status: 200 }),
    ) as unknown as Fetch;
    const { deps } = await makeDeps({ fetch });
    const update = vi.spyOn(deps.config, "update");
    const screen = new CatalogScreen(deps);

    await input(screen, "i");
    await input(screen, "n");
    await input(screen, Key.enter);

    expect(fetch).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("shows endpoint URLs and redacted keys in provider choices", async () => {
    const rawKey = ENDPOINT_API_KEY;
    const { deps } = await makeDeps({
      models: { providers: { relay: provider("relay", rawKey) } },
    });
    const screen = new CatalogScreen(deps);

    await input(screen, "i");
    const rendered = screen.render(120, 7).join("\n");

    expect(rendered).toContain("https://relay.example/v1");
    expect(rendered).toContain("sk-…1234");
    expect(rendered).not.toContain(rawKey);
  });

  it("keeps manual validation errors visible at fixed height", async () => {
    const { deps } = await makeDeps({ catalog: [] });
    const screen = new CatalogScreen(deps);

    await input(screen, "+");
    for (let index = 0; index < 5; index++) await input(screen, Key.down);
    await input(screen, Key.enter);
    await input(screen, Key.ctrl("s"));

    const rendered = screen.render(100, 5).join("\\n");
    expect(rendered).toContain(S.modelManager.catalog.labels.maxTokens);

    expect(rendered).toContain(S.modelManager.catalog.invalidId);
  });

  it("handles the catalog action keys and Esc transitions", async () => {
    const runtimeFactory = vi.fn(async () => ({
      getModels: () => [{ id: "builtin", contextWindow: 1000, maxTokens: 100 }],
    }));
    const { deps } = await makeDeps({ catalog: [catalogModel("m")], runtimeFactory });
    const screen = new CatalogScreen(deps);

    await input(screen, "i");
    expect(screen.render(100, 7).join("\n")).toContain(
      S.modelManager.catalog.endpointProviderHeader,
    );
    await input(screen, Key.escape);
    expect(screen.render(100, 7).join("\n")).toContain(S.modelManager.catalog.header(1));

    await input(screen, "p");
    expect(screen.render(100, 7).join("\n")).toContain(S.modelManager.catalog.builtinHeader);
    await input(screen, Key.escape);

    await input(screen, "+");
    expect(screen.render(100, 7).join("\n")).toContain(S.modelManager.catalog.manualTitle);
    await input(screen, Key.escape);

    await input(screen, "d");
    expect(screen.render(100, 7).join("\n")).toContain(S.modelManager.catalog.deleteTitle(1));
    await input(screen, Key.escape);

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
  });

  it("selects the first endpoint-imported model before adding it to the target provider", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: "new-endpoint" }] }), { status: 200 }),
    ) as unknown as Fetch;
    const { deps } = await makeDeps({
      fetch,
      catalog: [catalogModel("existing")],
    });
    const screen = new CatalogScreen({ ...deps, targetProviderId: "relay" });

    await screen.beginEndpointImport("relay");
    await input(screen, Key.space);
    await input(screen, Key.enter);

    const rendered = screen.render(100, 7).join("\n");
    expect(rendered).toContain("new-endpoint");
    expect(rendered.split("\n").find((line) => line.includes("new-endpoint"))).toContain("\x1b[7m");
    await input(screen, Key.enter);

    const saved = await deps.modelsFile.read();
    expect(saved.providers.relay?.models.map(({ id }) => id)).toEqual(["new-endpoint"]);
    expect(deps.onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps an endpoint-imported model selected when it is not the first visible catalog row", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: "new-endpoint" }] }), { status: 200 }),
    ) as unknown as Fetch;
    const { deps } = await makeDeps({
      fetch,
      catalog: [catalogModel("existing"), catalogModel("other")],
    });
    const screen = new CatalogScreen({ ...deps, targetProviderId: "relay" });

    await screen.beginEndpointImport("relay");
    await input(screen, Key.space);
    await input(screen, Key.enter);

    const rendered = screen.render(100, 7).join("\n");
    expect(rendered).toContain("new-endpoint");
    expect(rendered.split("\n").find((line) => line.includes("new-endpoint"))).toContain("\x1b[7m");
  });

  it("keeps a filtered endpoint import marked for the next provider add", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: "new-endpoint" }] }), { status: 200 }),
    ) as unknown as Fetch;
    const { deps } = await makeDeps({
      fetch,
      catalog: [catalogModel("existing")],
    });
    const screen = new CatalogScreen({ ...deps, targetProviderId: "relay" });

    await input(screen, "/");
    for (const character of "existing") await input(screen, character);
    await input(screen, Key.enter);
    await input(screen, "i");
    await input(screen, Key.space);
    await input(screen, Key.enter);
    await input(screen, Key.space);
    await input(screen, Key.enter);

    const filtered = screen.render(100, 7).join("\n");
    expect(filtered).toContain("existing");
    expect(filtered).not.toContain("new-endpoint");

    await input(screen, Key.enter);

    const saved = await deps.modelsFile.read();
    expect(saved.providers.relay?.models.map(({ id }) => id)).toEqual(["new-endpoint"]);
    expect(deps.onDone).toHaveBeenCalledTimes(1);
  });

  it("reports endpoint failures with a fixed safe string and performs no write", async () => {
    const secret = FAILURE_SECRET;
    const fetch = vi.fn(async () => {
      throw new Error(`upstream ${secret}`);
    }) as unknown as Fetch;
    const { deps, fs } = await makeDeps({ fetch });
    const update = vi.spyOn(deps.config, "update");
    const before = fs.files.get(CONFIG_PATH);
    const screen = new CatalogScreen(deps);

    await screen.beginEndpointImport("relay");

    const rendered = screen.render(100, 7).join("\n");
    expect(update).not.toHaveBeenCalled();
    expect(fs.files.get(CONFIG_PATH)).toBe(before);
    expect(rendered).toContain(S.modelManager.catalog.endpointImportFailed);
    expect(rendered).not.toContain(secret);
    expect(deps.notify).toHaveBeenCalledWith(S.modelManager.catalog.endpointImportFailed);
  });
});
