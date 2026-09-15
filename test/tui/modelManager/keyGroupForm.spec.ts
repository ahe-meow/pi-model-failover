import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../../../src/adapters/modelsJson.js";
import { ConfigStore } from "../../../src/config/configStore.js";
import { WriteQueue } from "../../../src/config/writeQueue.js";
import { redactSecret } from "../../../src/domain/redact.js";
import type { ModelsJson, ProviderNode } from "../../../src/domain/types.js";
import { S } from "../../../src/strings.js";
import { KeyGroupForm } from "../../../src/tui/tabs/modelManager/keyGroupForm.js";
import { type ModelManagerDeps, ModelManagerTab } from "../../../src/tui/tabs/modelManager.js";
import { MemoryFs } from "../../fakes/memoryFs.js";

const MODELS_PATH = "/d/models.json";
const CONFIG_PATH = "/d/config.json";
const API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

type FormValues = {
  prefix: string;
  baseUrl: string;
  api: (typeof API_TYPES)[number];
  headers: string;
  multiplier: string;
  keys: string;
};

const validValues: FormValues = {
  prefix: "relay",
  baseUrl: "https://relay.example/v1",
  api: "openai-completions",
  headers: "X-Team: blue",
  multiplier: "0.1",
  keys: "sk-key-0\nsk-key-1",
};

const provider = (id: string): ProviderNode => ({
  name: id,
  baseUrl: "https://existing.example/v1",
  api: "openai-completions",
  models: [],
});

interface TestDeps {
  deps: ModelManagerDeps;
  fs: MemoryFs;
}

async function makeDeps(source: ModelsJson): Promise<TestDeps> {
  const fs = new MemoryFs();
  const queue = new WriteQueue();
  fs.files.set(MODELS_PATH, `${JSON.stringify(source)}\n`);
  const config = await ConfigStore.open(fs, queue, "/d");
  const registrar = { syncOwned: vi.fn() };
  return {
    fs,
    deps: {
      config,
      modelsFile: new ModelsJsonFile(fs, queue, MODELS_PATH),
      initialModels: structuredClone(source),
      registrar,
      notify: vi.fn(),
      now: () => "2026-09-09T00:00:00.000Z",
      createKeyGroupId: () => "kg-test",
    },
  };
}

interface InputTarget {
  handleInput(data: string): void | Promise<void>;
}

async function input(target: InputTarget, data: string): Promise<void> {
  await target.handleInput(data);
}

async function setFormValues(target: InputTarget, values: FormValues): Promise<void> {
  const fields = ["prefix", "baseUrl", "api", "headers", "multiplier"] as const;
  for (const [index, field] of fields.entries()) {
    if (field === "api") {
      const option = API_TYPES.indexOf(values.api);
      for (let step = 0; step < option; step++) await input(target, Key.right);
    } else {
      if (field === "multiplier") await input(target, Key.backspace);
      for (const character of values[field]) await input(target, character);
    }
    if (index < fields.length - 1) await input(target, Key.down);
  }
  await input(target, Key.down);
  await input(target, Key.enter);
  await input(target, values.keys);
  await input(target, Key.ctrl("s"));
}

async function submit(target: InputTarget): Promise<void> {
  await input(target, Key.ctrl("s"));
}

async function setNonKeyFormValues(
  target: InputTarget,
  values: FormValues = validValues,
): Promise<void> {
  const fields = ["prefix", "baseUrl", "api", "headers", "multiplier"] as const;
  for (const [index, field] of fields.entries()) {
    if (field === "api") {
      const option = API_TYPES.indexOf(values.api);
      for (let step = 0; step < option; step++) await input(target, Key.right);
    } else {
      if (field === "multiplier") await input(target, Key.backspace);
      for (const character of values[field]) await input(target, character);
    }
    if (index < fields.length - 1) await input(target, Key.down);
  }
  await input(target, Key.down);
}

async function openKeyEntry(target: InputTarget): Promise<void> {
  await input(target, Key.enter);
}

describe("KeyGroupForm", () => {
  it("C1: submits twenty keys with one models write and one config group", async () => {
    const { deps, fs } = await makeDeps({ providers: {} });
    const writes = vi.spyOn(fs, "writeAtomic");
    const modelsUpdate = vi.spyOn(deps.modelsFile, "update");
    const configUpdate = vi.spyOn(deps.config, "update");
    const done = vi.fn();
    const form = new KeyGroupForm({ ...deps, onDone: done });
    const keys = Array.from({ length: 20 }, (_, index) => `sk-key-${index}`).join("\n");

    await setFormValues(form, { ...validValues, keys });
    await submit(form);

    const modelsWrites = writes.mock.calls.filter(([path]) => path === MODELS_PATH);
    const configWrites = writes.mock.calls.filter(([path]) => path === CONFIG_PATH);
    expect(modelsUpdate).toHaveBeenCalledTimes(1);
    expect(configUpdate).toHaveBeenCalledTimes(1);
    expect(modelsWrites).toHaveLength(1);
    expect(configWrites).toHaveLength(1);
    expect(Object.keys((await deps.modelsFile.read()).providers)).toHaveLength(20);
    expect(deps.config.get().keyGroups).toHaveLength(1);
    expect(JSON.stringify(deps.config.get().keyGroups)).not.toContain("sk-key-0");
    expect(done).toHaveBeenCalledTimes(1);
    expect(deps.registrar.syncOwned).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["prefix whitespace", { prefix: "relay name" }],
    ["prefix slash", { prefix: "relay/name" }],
    ["invalid URL", { baseUrl: "not-a-url" }],
    ["empty keys", { keys: "" }],
    ["extra key tokens", { keys: "sk-key-0 0.2 extra" }],
    ["zero multiplier", { multiplier: "0" }],
    ["negative multiplier", { multiplier: "-0.1" }],
    ["non-finite multiplier", { multiplier: "Infinity" }],
    ["invalid per-line multiplier", { keys: "sk-key-0 NaN" }],
  ] as Array<[string, Partial<FormValues>]>)(
    "rejects %s before either store is called",
    async (_label, override) => {
      const { deps, fs } = await makeDeps({ providers: {} });
      const modelsUpdate = vi.spyOn(deps.modelsFile, "update");
      const configUpdate = vi.spyOn(deps.config, "update");
      const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

      await setFormValues(form, { ...validValues, ...override } as FormValues);
      await submit(form);

      expect(modelsUpdate).not.toHaveBeenCalled();
      expect(configUpdate).not.toHaveBeenCalled();
      expect(JSON.parse(fs.files.get(MODELS_PATH) ?? "null")).toEqual({ providers: {} });
      expect(deps.notify).toHaveBeenCalledTimes(1);
    },
  );

  it("applies per-line multipliers over the default multiplier", async () => {
    const { deps } = await makeDeps({ providers: {} });
    const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

    await setFormValues(form, {
      ...validValues,
      keys: "sk-first 0.25\nsk-second",
    });
    await submit(form);

    const models = await deps.modelsFile.read();
    expect(models.providers["relay-1"]?.piModelFailover?.costMultiplier).toBe(0.25);
    expect(models.providers["relay-2"]?.piModelFailover?.costMultiplier).toBe(0.1);
  });

  it("continues suffix allocation after occupied provider ids", async () => {
    const { deps } = await makeDeps({
      providers: {
        "relay-1": provider("relay-1"),
        "relay-3": provider("relay-3"),
      },
    });
    const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

    await setFormValues(form, validValues);
    await submit(form);

    const models = await deps.modelsFile.read();
    expect(Object.keys(models.providers)).toEqual(["relay-1", "relay-3", "relay-2", "relay-4"]);
  });

  it("refreshes the registrar and then returns the saved snapshot", async () => {
    const { deps, fs } = await makeDeps({ providers: {} });
    const events: string[] = [];
    deps.registrar.syncOwned = vi.fn((models) => {
      events.push("registrar");
      expect(fs.files.get(MODELS_PATH)).toContain("relay-1");
      expect(fs.files.get(CONFIG_PATH)).toContain("kg-test");
      expect(models.providers["relay-1"]?.apiKey).toBe("sk-key-0");
    });
    const done = vi.fn((models: ModelsJson) => {
      events.push("done");
      expect(models.providers["relay-1"]?.apiKey).toBe("sk-key-0");
    });
    const form = new KeyGroupForm({ ...deps, onDone: done });

    await setFormValues(form, validValues);
    await submit(form);

    expect(events).toEqual(["registrar", "done"]);
  });

  it("redacts every key line in the rendered form", async () => {
    const { deps } = await makeDeps({ providers: {} });
    const keys = "sk-rendered-000\nsk-rendered-111";
    const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

    await setFormValues(form, { ...validValues, keys });
    const rendered = form.render(120, 40).join("\n");

    expect(rendered).not.toContain("sk-rendered-000");
    expect(rendered).not.toContain("sk-rendered-111");
    expect(rendered).toContain(redactSecret("sk-rendered-000"));
    expect(rendered).toContain(redactSecret("sk-rendered-111"));
  });

  it("shows a distinct key-entry title and dedicated hints while active", async () => {
    const { deps } = await makeDeps({ providers: {} });
    const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

    await setNonKeyFormValues(form);
    await openKeyEntry(form);

    const rendered = form.render(120, 40).join("\n");
    expect(rendered).toContain("Enter API keys");
    expect(rendered).not.toContain(S.modelManager.keyGroupForm.title);
    expect(form.hints()).toEqual([
      ["Enter", "commit row"],
      ["Ctrl+S", "save and return"],
      ["Esc", "cancel"],
    ]);
  });

  it("shows keys only while the dedicated key-entry interface is active", async () => {
    const { deps } = await makeDeps({ providers: {} });
    const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

    await setNonKeyFormValues(form);
    await openKeyEntry(form);
    await input(form, "sk-visible");

    const active = form.render(120, 40).join("\n");
    expect(active).toContain("sk-visible");

    await input(form, "\u0013");
    const returned = form.render(120, 40).join("\n");
    expect(returned).not.toContain("sk-visible");
    expect(returned).toContain(redactSecret("sk-visible"));
  });

  it("commits each non-empty row and persists the saved list with per-line multipliers", async () => {
    const { deps } = await makeDeps({ providers: {} });
    const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

    await setNonKeyFormValues(form);
    await openKeyEntry(form);
    for (const character of "sk-first 0.25") await input(form, character);
    await input(form, Key.enter);
    for (const character of "sk-second") await input(form, character);

    const active = form.render(120, 40).join("\n");
    expect(active).toContain("sk-first 0.25");
    expect(active).toContain("sk-second");

    await input(form, Key.ctrl("s"));
    await input(form, Key.ctrl("s"));

    const models = await deps.modelsFile.read();
    expect(models.providers["relay-1"]?.apiKey).toBe("sk-first");

    expect(models.providers["relay-1"]?.piModelFailover?.costMultiplier).toBe(0.25);
    expect(models.providers["relay-2"]?.apiKey).toBe("sk-second");
    expect(models.providers["relay-2"]?.piModelFailover?.costMultiplier).toBe(0.1);
  });

  it("keeps saved parent key values when a later child edit is canceled", async () => {
    const { deps } = await makeDeps({ providers: {} });
    const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

    await setNonKeyFormValues(form);
    await openKeyEntry(form);
    await input(form, "sk-original");
    await input(form, "\u0013");

    await input(form, Key.up);
    await input(form, Key.down);
    await input(form, Key.enter);
    await input(form, "sk-new");
    await input(form, Key.escape);

    const returned = form.render(120, 40).join("\n");
    expect(returned).toContain(redactSecret("sk-original"));
    expect(returned).not.toContain("sk-new");
    expect(returned).toContain("relay");
    expect(returned).toContain("https://relay.example/v1");
    expect(returned).toContain("X-Team: blue");
  });

  it("cancels key-entry edits without returning raw keys to the batch form", async () => {
    const { deps } = await makeDeps({ providers: {} });
    const modelsUpdate = vi.spyOn(deps.modelsFile, "update");
    const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

    await setNonKeyFormValues(form);
    await openKeyEntry(form);
    await input(form, "sk-cancel");
    expect(form.render(120, 40).join("\n")).toContain("sk-cancel");

    await input(form, Key.escape);

    const returned = form.render(120, 40).join("\n");
    expect(returned).not.toContain("sk-cancel");
    expect(modelsUpdate).not.toHaveBeenCalled();
  });

  it("submits the saved batch through the existing persistence flow", async () => {
    const { deps, fs } = await makeDeps({ providers: {} });
    const form = new KeyGroupForm({ ...deps, onDone: vi.fn() });

    await setNonKeyFormValues(form);
    await openKeyEntry(form);
    for (const character of "sk-persisted") await input(form, character);
    await input(form, Key.enter);
    await input(form, Key.ctrl("s"));
    await input(form, Key.ctrl("s"));

    expect(JSON.parse(fs.files.get(MODELS_PATH) ?? "null").providers["relay-1"].apiKey).toBe(
      "sk-persisted",
    );
    expect(deps.config.get().keyGroups).toHaveLength(1);
  });

  it("opens and cancels the form from the provider list", async () => {
    const { deps } = await makeDeps({ providers: { relay: provider("relay") } });
    const tab = new ModelManagerTab(deps);

    await input(tab, "k");
    expect(tab.render(100, 7).join("\n")).toContain(S.modelManager.keyGroupForm.title);

    await input(tab, Key.escape);
    const rendered = tab.render(100, 7).join("\n");
    expect(rendered).toContain("Provider");
    expect(rendered).toContain("Models");
  });

  it("returns to the provider list after a successful tab submission", async () => {
    const { deps } = await makeDeps({ providers: {} });
    const tab = new ModelManagerTab(deps);

    await input(tab, "k");
    await setFormValues(tab, validValues);
    await submit(tab);

    const rendered = tab.render(100, 7).join("\n");
    expect(rendered).toContain("Provider");
    expect(rendered).toContain("Models");
    expect(rendered).toContain("relay-1");
  });
});
