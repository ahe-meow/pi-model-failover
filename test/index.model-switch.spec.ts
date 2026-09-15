import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../src/adapters/modelsJson.js";
import { nodeFs } from "../src/adapters/nodeFs.js";
import { WriteQueue } from "../src/config/writeQueue.js";
import type { ModelNode, ModelsJson, ProviderNode } from "../src/domain/types.js";
import factory from "../src/index.js";
import { S } from "../src/strings.js";
import { FakePi } from "./fakes/fakePi.js";

const runtime = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  getAgentDir: () => runtime.agentDir,
  ModelRuntime: { create: vi.fn(async () => ({ getModels: () => [] })) },
}));

const model: ModelNode = {
  id: "m",
  name: "Model",
  reasoning: false,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const provider: ProviderNode = {
  name: "relay",
  baseUrl: "https://relay.example/v1",
  api: "openai-completions",
  models: [model],
  piModelFailover: { group: "kg-test", costMultiplier: 0.1 },
};

type App = { handleInput(data: string): void };
type ComponentFactory = (
  tui: unknown,
  theme: unknown,
  keybindings: unknown,
  done: (result: unknown) => void,
) => App;

async function openModelManager(setModel: () => Promise<boolean>, find: () => unknown) {
  runtime.agentDir = mkdtempSync(join(tmpdir(), "pmf-model-switch-"));
  const modelsFile = new ModelsJsonFile(
    nodeFs,
    new WriteQueue(),
    join(runtime.agentDir, "models.json"),
  );
  const models: ModelsJson = { providers: { relay: provider } };
  await modelsFile.update(() => structuredClone(models));
  const pi = new FakePi();
  Object.assign(pi, { setModel });
  await factory(pi as never);

  let app: App | undefined;
  const notify = vi.fn();
  const custom = vi.fn(async (makeComponent: ComponentFactory) => {
    app = makeComponent({}, {}, {}, () => {});
  });
  await pi.commands.get("failover")?.("", {
    mode: "tui",
    modelRegistry: { find },
    thinkingLevel: "medium",
    ui: { notify, custom },
  });
  return { app, notify };
}

describe("model switching integration", () => {
  it("notifies when the selected model is unavailable", async () => {
    const setModel = vi.fn(async () => true);
    const { app, notify } = await openModelManager(setModel, () => undefined);

    app?.handleInput(Key.enter);
    app?.handleInput("p");
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(S.modelSwitch.unavailable, "warning"),
    );
    expect(setModel).not.toHaveBeenCalled();
  });

  it("reports missing authentication when Pi rejects model selection", async () => {
    const setModel = vi.fn(async () => false);
    const { app, notify } = await openModelManager(setModel, () => ({
      provider: "relay",
      id: "m",
    }));

    app?.handleInput(Key.enter);
    app?.handleInput("p");
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(S.modelSwitch.authMissing("relay/m"), "warning"),
    );
  });

  it("reports a safe message when Pi model selection throws", async () => {
    const setModel = vi.fn(async () => {
      throw new Error("private authentication response");
    });
    const { app, notify } = await openModelManager(setModel, () => ({
      provider: "relay",
      id: "m",
    }));

    app?.handleInput(Key.enter);
    app?.handleInput("p");
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(S.modelSwitch.failed, "warning"));
    expect(JSON.stringify(notify.mock.calls)).not.toContain("private authentication response");
  });
});
