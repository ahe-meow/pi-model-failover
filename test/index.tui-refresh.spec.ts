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
import { FakePi } from "./fakes/fakePi.js";

const mockRuntime = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  getAgentDir: () => mockRuntime.agentDir,
  ModelRuntime: { create: vi.fn(async () => ({ getModels: () => [] })) },
}));

const modelNode: ModelNode = {
  id: "m",
  name: "Model",
  reasoning: false,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const ownedProvider = (id: string): ProviderNode => ({
  name: id,
  baseUrl: `https://${id}.example/v1`,
  api: "openai-completions",
  models: [modelNode],
  piModelFailover: { group: "kg-test", costMultiplier: 0.1 },
});

async function makeFactory() {
  mockRuntime.agentDir = mkdtempSync(join(tmpdir(), "pmf-refresh-"));
  const modelsFile = new ModelsJsonFile(
    nodeFs,
    new WriteQueue(),
    join(mockRuntime.agentDir, "models.json"),
  );
  const models: ModelsJson = { providers: { relay: ownedProvider("relay") } };
  await modelsFile.update(() => structuredClone(models));
  await nodeFs.mkdir(join(mockRuntime.agentDir, "pi-model-failover"), 0o700);
  return { pi: new FakePi() };
}

type App = { handleInput(data: string): void };
type ComponentFactory = (
  tui: unknown,
  theme: unknown,
  keybindings: unknown,
  done: (result: unknown) => void,
) => App;

describe("TUI refresh integration", () => {
  it("requests a host render after a model-list save", async () => {
    const { pi } = await makeFactory();
    await factory(pi as never);

    const requestRender = vi.fn();
    let app: App | undefined;
    const custom = vi.fn(async (makeComponent: ComponentFactory) => {
      app = makeComponent({ requestRender }, {}, {}, () => {});
    });
    await pi.commands.get("failover")?.("", {
      mode: "tui",
      modelRegistry: {},
      thinkingLevel: "medium",
      ui: { notify: vi.fn(), custom },
    });

    app?.handleInput("d");
    app?.handleInput(Key.left);
    app?.handleInput(Key.enter);

    await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
  });
});
