import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { type ConfigFile, ConfigStore } from "../../../src/config/configStore.js";
import { WriteQueue } from "../../../src/config/writeQueue.js";
import type { Chain, ModelNode, ModelsJson } from "../../../src/domain/types.js";
import {
  ImportPreview,
  type ImportPreviewOptions,
} from "../../../src/tui/tabs/chains/importPreview.js";
import { MemoryFs } from "../../fakes/memoryFs.js";

const node = (id: string): ModelNode => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  contextWindow: 8_000,
  maxTokens: 1_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const models: ModelsJson = {
  providers: {
    b: {
      name: "B",
      baseUrl: "https://b.example/v1",
      api: "openai-completions",
      models: [node("m")],
      piModelFailover: { group: null, costMultiplier: 1 },
    },
    a: {
      name: "A",
      baseUrl: "https://a.example/v1",
      api: "openai-completions",
      models: [node("m")],
      piModelFailover: { group: null, costMultiplier: 0.1 },
    },
    c: {
      name: "C",
      baseUrl: "https://c.example/v1",
      api: "openai-completions",
      models: [node("m")],
      piModelFailover: { group: null, costMultiplier: 0.1 },
    },
  },
};
const chain: Chain = { id: "coding", name: "Coding", targets: [] };

async function makeDeps(): Promise<ImportPreviewOptions & { config: ConfigStore }> {
  const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
  await config.update((value) => {
    value.chains = [structuredClone(chain)];
    value.catalog = [
      {
        id: "m",
        reasoning: false,
        vision: false,
        contextWindow: 8_000,
        maxTokens: 1_000,
        defaults: {},
      },
    ];
  });
  return {
    config,
    chainId: chain.id,
    modelId: "m",
    models: () => models,
    registrar: { syncFailover: vi.fn() },
    onDone: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe("ImportPreview", () => {
  it("C16: previews and appends providers in multiplier/id order", async () => {
    const deps = await makeDeps();
    const update = vi.spyOn(deps.config, "update");
    const preview = new ImportPreview(deps);
    const rendered = preview.render(78, 7).join("\n");

    expect(rendered.indexOf("a")).toBeLessThan(rendered.indexOf("c"));
    expect(rendered.indexOf("c")).toBeLessThan(rendered.indexOf("b"));
    await preview.handleInput(Key.enter);

    expect(update).toHaveBeenCalledTimes(1);
    expect(deps.config.get().chains[0]?.targets).toEqual([
      { provider: "a", modelId: "m" },
      { provider: "c", modelId: "m" },
      { provider: "b", modelId: "m" },
    ]);
    expect(deps.registrar.syncFailover).toHaveBeenCalledTimes(1);
    expect(deps.onDone).toHaveBeenCalledTimes(1);
  });

  it("opens the import filter from Kitty slash input", async () => {
    const deps = await makeDeps();
    const preview = new ImportPreview(deps);

    await preview.handleInput("\u001b[47;1u");
    for (const character of "c") await preview.handleInput(character);
    await preview.handleInput(Key.enter);

    const rendered = preview.render(78, 7).join("\n");
    expect(rendered).toContain("c/m");
    expect(rendered).not.toContain("a/m");
  });

  it("reports filter editing state to its parent screen", async () => {
    const deps = await makeDeps();
    const preview = new ImportPreview(deps);

    expect(preview.isEditing()).toBe(false);
    await preview.handleInput("/");
    expect(preview.isEditing()).toBe(true);
    await preview.handleInput(Key.escape);
    expect(preview.isEditing()).toBe(false);
  });

  it("keeps the ImportPreview draft at body height", async () => {
    const deps = await makeDeps();
    const preview = new ImportPreview(deps);

    const normalHeight = preview.render(78, 7).length;
    await preview.handleInput("/");
    expect(preview.render(78, 7)).toHaveLength(normalHeight);
  });

  it("filters target choices and maps a marked visible target to its source", async () => {
    const deps = await makeDeps();
    const update = vi.spyOn(deps.config, "update");
    const preview = new ImportPreview(deps);

    await preview.handleInput("n");
    await preview.handleInput("/");
    await preview.handleInput("c");
    await preview.handleInput(Key.escape);
    let rendered = preview.render(78, 7).join("\n");
    expect(rendered).toContain("a/m");
    expect(rendered).toContain("c/m");

    await preview.handleInput("/");
    await preview.handleInput("c");
    await preview.handleInput(Key.enter);
    rendered = preview.render(78, 7).join("\n");
    expect(rendered).toContain("c/m");
    expect(rendered).not.toContain("a/m");
    expect(rendered).not.toContain("b/m");
    expect(update).not.toHaveBeenCalled();

    await preview.handleInput(Key.space);
    await preview.handleInput(Key.enter);
    expect(deps.config.get().chains[0]?.targets).toEqual([{ provider: "c", modelId: "m" }]);
  });

  it("does not confirm hidden default marks when filtering to zero rows", async () => {
    const deps = await makeDeps();
    await deps.config.update((value) => {
      const current = value.chains[0];
      if (current !== undefined) current.targets = [{ provider: "a", modelId: "m" }];
    });
    const update = vi.spyOn(deps.config, "update");
    const preview = new ImportPreview(deps);

    await preview.handleInput("/");
    for (const character of "missing") await preview.handleInput(character);
    await preview.handleInput(Key.enter);
    await preview.handleInput(Key.enter);

    expect(update).not.toHaveBeenCalled();
    expect(deps.onDone).not.toHaveBeenCalled();
  });

  it("keeps existing targets unmarked and leaves them unchanged", async () => {
    const deps = await makeDeps();
    await deps.config.update((value: ConfigFile) => {
      const chain = value.chains[0];
      if (chain !== undefined) chain.targets = [{ provider: "a", modelId: "m" }];
    });
    const preview = new ImportPreview(deps);

    expect(preview.render(78, 7).join("\n")).toContain("a");
    await preview.handleInput(Key.enter);

    expect(deps.config.get().chains[0]?.targets).toEqual([
      { provider: "a", modelId: "m" },
      { provider: "c", modelId: "m" },
      { provider: "b", modelId: "m" },
    ]);
  });
});
