import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../../../src/adapters/modelsJson.js";
import { ConfigStore } from "../../../src/config/configStore.js";
import { WriteQueue } from "../../../src/config/writeQueue.js";
import type { Fetch } from "../../../src/domain/ports.js";
import type { CatalogModel, ModelsJson, ProviderNode } from "../../../src/domain/types.js";
import { S } from "../../../src/strings.js";
import {
  CatalogScreen,
  type CatalogScreenDeps,
} from "../../../src/tui/tabs/modelManager/catalogScreen.js";
import { MemoryFs } from "../../fakes/memoryFs.js";

const MODELS_PATH = "/d/models.json";
const RELAY_API_KEY = ["sk", "relay-secret-1234"].join("-");

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

async function filter(target: InputTarget, query: string): Promise<void> {
  await input(target, "/");
  for (const character of query) await input(target, character);
  await input(target, Key.enter);
}

describe("CatalogScreen slash filtering", () => {
  it("does not edit or delete hidden Catalog rows after a zero-result filter", async () => {
    const options = { catalog: [catalogModel("one"), catalogModel("two")] };
    const first = await makeDeps(options);
    const editScreen = new CatalogScreen(first.deps);
    await input(editScreen, "a");
    await filter(editScreen, "missing");
    await input(editScreen, "e");
    expect(editScreen.render(100, 7).join("\n")).not.toContain(S.modelManager.catalog.manualTitle);

    const second = await makeDeps(options);
    const deleteScreen = new CatalogScreen(second.deps);
    await filter(deleteScreen, "missing");
    await input(deleteScreen, "d");
    expect(deleteScreen.render(100, 7).join("\n")).not.toContain(
      S.modelManager.catalog.deleteTitle(1),
    );
  });

  it("opens the Catalog filter from Kitty slash input", async () => {
    const { deps } = await makeDeps({
      catalog: [catalogModel("other-model"), catalogModel("zz-model")],
    });
    const screen = new CatalogScreen(deps);

    await input(screen, "\u001b[47;1u");
    await input(screen, "z");
    await input(screen, Key.enter);

    const rendered = screen.render(100, 7).join("\n");
    expect(rendered).toContain("zz-model");
    expect(rendered).not.toContain("other-model");
  });

  it.each([
    ["unfiltered page down", [Key.pageDown], "model-6", ""],
    ["unfiltered page up", [Key.end, Key.pageUp], "model-5", ""],
    ["unfiltered home", [Key.home], "model-0", ""],
    ["unfiltered end", [Key.end], "model-11", ""],
    ["filtered page down", [Key.pageDown], "match-6", "match"],
    ["filtered page up", [Key.end, Key.pageUp], "match-5", "match"],
    ["filtered home", [Key.home], "match-0", "match"],
    ["filtered end", [Key.end], "match-11", "match"],
  ])("uses the visible Catalog highlight for %s", async (_name, movement, expected, query) => {
    const catalog = Array.from({ length: 12 }, (_, index) =>
      catalogModel(query === "" ? `model-${index}` : `match-${index}`),
    );
    const { deps } = await makeDeps({ catalog });
    const screen = new CatalogScreen(deps);
    if (query !== "") await filter(screen, query);
    screen.render(100, 7);
    for (const key of movement) await input(screen, key);
    await input(screen, "e");

    expect(screen.render(100, 7).join("\n")).toContain(expected);
  });

  it("filters the Catalog list display-only and supports cancel then clear", async () => {
    const { deps } = await makeDeps({
      catalog: [catalogModel("other-model"), catalogModel("zz-model")],
    });
    const update = vi.spyOn(deps.config, "update");
    const screen = new CatalogScreen(deps);

    await input(screen, "/");
    for (const character of "zz") await input(screen, character);
    await input(screen, Key.escape);
    let rendered = screen.render(100, 7).join("\n");
    expect(rendered).toContain("other-model");
    expect(rendered).toContain("zz-model");

    await filter(screen, "zz");
    rendered = screen.render(100, 7).join("\n");
    expect(rendered).toContain("zz-model");
    expect(rendered).not.toContain("other-model");
    expect(update).not.toHaveBeenCalled();

    await input(screen, Key.escape);
    expect(screen.render(100, 7).join("\n")).toContain("other-model");
  });

  it("resets the endpoint filter when loading a new result set", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "old-model" }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "new-model" }] }), { status: 200 }),
      ) as unknown as Fetch;
    const { deps } = await makeDeps({ fetch });
    const screen = new CatalogScreen(deps);

    await screen.beginEndpointImport("relay");
    await filter(screen, "old");
    await screen.beginEndpointImport("relay");

    expect(screen.render(100, 7).join("\n")).toContain("new-model");
  });

  it("resets builtin and provider-target filters for new contexts", async () => {
    let builtinCall = 0;
    const runtimeFactory = vi.fn(async () => ({
      getModels: () => {
        builtinCall += 1;
        return [
          {
            id: builtinCall === 1 ? "old-builtin" : "new-builtin",
            contextWindow: 1000,
            maxTokens: 100,
          },
        ];
      },
    }));
    const builtin = await makeDeps({ runtimeFactory });
    const builtinScreen = new CatalogScreen(builtin.deps);
    await input(builtinScreen, "p");
    await filter(builtinScreen, "old");
    await input(builtinScreen, Key.escape);
    await input(builtinScreen, Key.escape);
    await input(builtinScreen, "p");
    expect(builtinScreen.render(100, 7).join("\n")).toContain("new-builtin");

    const providerContext = await makeDeps({ catalog: [catalogModel("m")] });
    const providerScreen = new CatalogScreen(providerContext.deps);
    await providerScreen.beginProviderAdd("m");
    await filter(providerScreen, "relay");
    providerScreen.refresh({
      providers: {
        fresh: { ...provider("fresh"), baseUrl: "https://fresh.example/v1" },
      },
    });
    await providerScreen.beginProviderAdd("m");
    expect(providerScreen.render(100, 7).join("\n")).toContain("fresh");
  });

  it("keeps every Catalog mode draft at the normal body height", async () => {
    const check = async (screen: CatalogScreen): Promise<void> => {
      const normalHeight = screen.render(100, 7).length;
      await input(screen, "/");
      expect(screen.render(100, 7)).toHaveLength(normalHeight);
    };

    const catalog = await makeDeps({ catalog: [catalogModel("m")] });
    await check(new CatalogScreen(catalog.deps));

    const endpointProvider = await makeDeps();
    const endpointProviderScreen = new CatalogScreen(endpointProvider.deps);
    await input(endpointProviderScreen, "i");
    await check(endpointProviderScreen);

    const endpointModels = await makeDeps();
    const endpointModelsScreen = new CatalogScreen(endpointModels.deps);
    await endpointModelsScreen.beginEndpointImport("relay");
    await check(endpointModelsScreen);

    const builtin = await makeDeps({
      runtimeFactory: vi.fn(async () => ({
        getModels: () => [{ id: "builtin", contextWindow: 1000, maxTokens: 100 }],
      })),
    });
    const builtinScreen = new CatalogScreen(builtin.deps);
    await input(builtinScreen, "p");
    await check(builtinScreen);

    const providerTargets = await makeDeps({ catalog: [catalogModel("m")] });
    const providerTargetsScreen = new CatalogScreen(providerTargets.deps);
    await providerTargetsScreen.beginProviderAdd("m");
    await check(providerTargetsScreen);
  });

  it("filters endpoint provider choices before selecting the matching provider", async () => {
    const beta = provider("beta", "beta-key");
    beta.baseUrl = "https://beta.example/v1";
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "endpoint-model" }] }), { status: 200 }),
    ) as unknown as Fetch;
    const { deps } = await makeDeps({
      models: { providers: { relay: provider("relay"), beta } },
      fetch,
    });
    const update = vi.spyOn(deps.config, "update");
    const screen = new CatalogScreen(deps);

    await input(screen, "i");
    await filter(screen, "beta");
    const rendered = screen.render(100, 7).join("\n");
    expect(rendered).toContain("beta");
    expect(rendered).not.toContain("relay");
    expect(update).not.toHaveBeenCalled();

    await input(screen, Key.space);
    await input(screen, Key.enter);
    expect(fetch).toHaveBeenCalledWith(
      "https://beta.example/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer beta-key" }),
      }),
    );
    expect(screen.render(100, 7).join("\n")).toContain("endpoint-model");
  });

  it("filters endpoint model choices and maps the marked visible row to its source", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "other-endpoint" }, { id: "zz-endpoint" }] }), {
          status: 200,
        }),
    ) as unknown as Fetch;
    const { deps } = await makeDeps({ fetch });
    const update = vi.spyOn(deps.config, "update");
    const screen = new CatalogScreen(deps);

    await screen.beginEndpointImport("relay");
    await filter(screen, "zz");
    expect(screen.render(100, 7).join("\n")).toContain("zz-endpoint");
    expect(screen.render(100, 7).join("\n")).not.toContain("other-endpoint");
    expect(update).not.toHaveBeenCalled();

    await input(screen, Key.space);
    await input(screen, Key.enter);
    expect(deps.config.get().catalog.map(({ id }) => id)).toEqual(["zz-endpoint"]);
  });

  it("filters built-in model choices before importing the matching row", async () => {
    const runtimeFactory = vi.fn(async () => ({
      getModels: () => [
        { id: "other-builtin", contextWindow: 1000, maxTokens: 100 },
        { id: "zz-builtin", contextWindow: 2000, maxTokens: 200 },
      ],
    }));
    const { deps } = await makeDeps({ runtimeFactory });
    const update = vi.spyOn(deps.config, "update");
    const screen = new CatalogScreen(deps);

    await input(screen, "p");
    await filter(screen, "zz");
    expect(screen.render(100, 7).join("\n")).toContain("zz-builtin");
    expect(screen.render(100, 7).join("\n")).not.toContain("other-builtin");
    expect(update).not.toHaveBeenCalled();

    await input(screen, Key.space);
    await input(screen, Key.enter);
    expect(deps.config.get().catalog.map(({ id }) => id)).toEqual(["zz-builtin"]);
  });

  it("filters provider targets and maps the marked visible provider", async () => {
    const beta = provider("beta", "beta-key");
    beta.baseUrl = "https://beta.example/v1";
    const models: ModelsJson = { providers: { relay: provider("relay"), beta } };
    const { deps } = await makeDeps({ models, catalog: [catalogModel("m")] });
    const writes = vi.spyOn(deps.modelsFile, "update");
    const screen = new CatalogScreen(deps);

    await screen.beginProviderAdd("m");
    await filter(screen, "beta");
    expect(screen.render(100, 7).join("\n")).toContain("beta");
    expect(screen.render(100, 7).join("\n")).not.toContain("relay");
    expect(writes).not.toHaveBeenCalled();

    await input(screen, Key.space);
    await input(screen, Key.enter);
    const saved = await deps.modelsFile.read();
    expect(saved.providers.beta?.models.map(({ id }) => id)).toEqual(["m"]);
    expect(saved.providers.relay?.models).toEqual([]);
  });

  it("does not confirm zero-result endpoint, builtin, or provider-target modes", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "endpoint-model" }] }), { status: 200 }),
    ) as unknown as Fetch;
    const endpoint = await makeDeps({ fetch });
    const endpointScreen = new CatalogScreen(endpoint.deps);
    await input(endpointScreen, "i");
    await filter(endpointScreen, "missing");
    await input(endpointScreen, Key.enter);
    expect(fetch).not.toHaveBeenCalled();

    const runtimeFactory = vi.fn(async () => ({
      getModels: () => [{ id: "builtin-model", contextWindow: 1000, maxTokens: 100 }],
    }));
    const builtin = await makeDeps({ runtimeFactory });
    const builtinScreen = new CatalogScreen(builtin.deps);
    await input(builtinScreen, "p");
    await filter(builtinScreen, "missing");
    await input(builtinScreen, Key.enter);
    expect(builtin.deps.config.get().catalog).toEqual([]);

    const providerTargets = await makeDeps({ catalog: [catalogModel("m")] });
    const modelsUpdate = vi.spyOn(providerTargets.deps.modelsFile, "update");
    const providerScreen = new CatalogScreen(providerTargets.deps);
    await providerScreen.beginProviderAdd("m");
    await filter(providerScreen, "missing");
    await input(providerScreen, Key.enter);
    expect(modelsUpdate).not.toHaveBeenCalled();
  });
});
