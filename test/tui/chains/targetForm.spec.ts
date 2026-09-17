import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../../../src/config/configStore.js";
import { WriteQueue } from "../../../src/config/writeQueue.js";
import type { Chain, ModelNode, ModelsJson, Settings, Target } from "../../../src/domain/types.js";
import { S } from "../../../src/strings.js";
import { TargetForm, type TargetFormOptions } from "../../../src/tui/tabs/chains/targetForm.js";
import { MemoryFs } from "../../fakes/memoryFs.js";

const settings: Settings = {
  listRows: 7,
  errorHandlingMode: "smart",
  maxRetries: 5,
  reasoningEffort: "inherit",
  modelParameters: { temperature: 0.2 },
  noProgressTimeoutSeconds: 90,
  ttftTimeoutSeconds: 60,
  serverQuality: { enabled: true, ttft: true, noProgress: true },
};
const model: ModelNode = {
  id: "m",
  name: "Model",
  reasoning: true,
  input: ["text"],
  contextWindow: 8_000,
  maxTokens: 1_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const target = {
  provider: "relay",
  modelId: "m",
  unknownTarget: "keep",
  serverQuality: { enabled: false, ttft: true, unknownSignal: "keep" },
} as unknown as Target;
const chain: Chain = { id: "coding", name: "Coding", targets: [target] };
const models: ModelsJson = {
  providers: {
    relay: {
      name: "Relay",
      baseUrl: "https://relay.example/v1",
      api: "openai-completions",
      models: [model],
    },
  },
};

async function makeDeps(): Promise<TargetFormOptions & { config: ConfigStore }> {
  const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
  await config.update((value) => {
    value.settings = structuredClone(settings);
    value.chains = [structuredClone(chain)];
  });
  return {
    config,
    chainId: chain.id,
    targetIndex: 0,
    models: () => models,
    registrar: { syncFailover: vi.fn() },
    notify: vi.fn(),
    onDone: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe("TargetForm", () => {
  it("shows the Server Quality warning for a disabled effective target policy", async () => {
    const form = new TargetForm(await makeDeps());
    expect(form.render(120, 12).join("\n")).toContain(S.serverQualityDisabledWarning);
  });

  it("offers inherit, on, off for each Server Quality switch", async () => {
    const form = new TargetForm(await makeDeps());
    const rendered = form.render(160, 12).join("\n");
    expect(rendered.match(/\[.\] (inherit|on|off)/g)?.length).toBeGreaterThanOrEqual(9);
    expect(rendered).toContain(S.chains.targetForm.labels.serverQualityEnabled);
    expect(rendered).toContain(S.chains.targetForm.labels.serverQualityTtft);
    expect(rendered).toContain(S.chains.targetForm.labels.serverQualityNoProgress);
  });

  it("saves tri-state overrides while retaining unknown target data", async () => {
    const deps = await makeDeps();
    const update = vi.spyOn(deps.config, "update");
    const form = new TargetForm(deps);

    for (let index = 0; index < 5; index++) await form.handleInput(Key.down);
    await form.handleInput(Key.enter);
    await form.handleInput(Key.up);
    await form.handleInput(Key.up);
    await form.handleInput(Key.enter);
    await form.handleInput(Key.ctrl("s"));

    await form.handleInput(Key.down);
    await form.handleInput(Key.enter);
    await form.handleInput(Key.down);
    await form.handleInput(Key.enter);
    await form.handleInput(Key.ctrl("s"));

    await form.handleInput(Key.down);
    await form.handleInput(Key.enter);
    await form.handleInput(Key.down);
    await form.handleInput(Key.enter);
    await form.handleInput(Key.ctrl("s"));

    expect(update).toHaveBeenCalledTimes(3);
    const saved = deps.config.get().chains[0]?.targets[0];
    expect(saved).toMatchObject({ provider: "relay", modelId: "m", unknownTarget: "keep" });
    expect(saved?.serverQuality).toEqual({ ttft: false, noProgress: true, unknownSignal: "keep" });
    expect(deps.registrar.syncFailover).toHaveBeenCalledTimes(3);
    expect(deps.onDone).toHaveBeenCalledTimes(3);
  });

  it("saves target settings through one ConfigStore update", async () => {
    const deps = await makeDeps();
    const update = vi.spyOn(deps.config, "update");
    const form = new TargetForm(deps);

    await form.handleInput(Key.ctrl("s"));

    expect(update).toHaveBeenCalledTimes(1);
    expect(deps.registrar.syncFailover).toHaveBeenCalledTimes(1);
    expect(deps.onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps the focused Server Quality field visible at minimum rows", async () => {
    const form = new TargetForm(await makeDeps());
    for (let index = 0; index < 6; index++) await form.handleInput(Key.down);

    const rendered = form.render(78, 5);
    expect(rendered).toHaveLength(6);
    expect(rendered.join("\n")).toContain(S.chains.targetForm.labels.serverQualityTtft);
  });

  it("renders a fixed body and cancels without writing", async () => {
    const deps = await makeDeps();
    const update = vi.spyOn(deps.config, "update");
    const form = new TargetForm(deps);

    expect(form.render(78, 5)).toHaveLength(6);
    await form.handleInput(Key.escape);
    expect(update).toHaveBeenCalledTimes(0);
    expect(deps.onCancel).toHaveBeenCalledTimes(1);
  });
});
