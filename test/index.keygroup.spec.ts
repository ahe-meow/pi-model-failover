import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../src/adapters/modelsJson.js";
import { nodeFs } from "../src/adapters/nodeFs.js";
import { WriteQueue } from "../src/config/writeQueue.js";
import factory from "../src/index.js";
import { S } from "../src/strings.js";
import { FakePi } from "./fakes/fakePi.js";

const mockRuntime = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  getAgentDir: () => mockRuntime.agentDir,
  ModelRuntime: { create: vi.fn(async () => ({ getModels: () => [] })) },
}));

const MODELS_PATH = "models.json";
const keyGroupValues = {
  prefix: "relay",
  baseUrl: "https://relay.example/v1",
  headers: "X-Team: blue",
  key: "sk-root-key",
};

type App = { handleInput(data: string): void };
type ComponentFactory = (
  tui: unknown,
  theme: unknown,
  keybindings: unknown,
  done: (result: unknown) => void,
) => App;

async function makePi(): Promise<FakePi> {
  mockRuntime.agentDir = mkdtempSync(join(tmpdir(), "pmf-keygroup-"));
  const modelsFile = new ModelsJsonFile(
    nodeFs,
    new WriteQueue(),
    join(mockRuntime.agentDir, MODELS_PATH),
  );
  await modelsFile.update(() => ({ providers: {} }));
  await nodeFs.mkdir(join(mockRuntime.agentDir, "pi-model-failover"), 0o700);
  return new FakePi();
}

function fillKeyGroup(app: App): void {
  app.handleInput("k");
  for (const character of keyGroupValues.prefix) app.handleInput(character);
  app.handleInput(Key.down);
  for (const character of keyGroupValues.baseUrl) app.handleInput(character);
  app.handleInput(Key.down);
  app.handleInput(Key.down);
  for (const character of keyGroupValues.headers) app.handleInput(character);
  app.handleInput(Key.down);
  app.handleInput(Key.down);
  app.handleInput(Key.enter);
  for (const character of keyGroupValues.key) app.handleInput(character);
  app.handleInput(Key.ctrl("s"));
  app.handleInput(Key.ctrl("s"));
}

describe("Key Group entry notification", () => {
  it("reports a successful save at info severity through the root TUI", async () => {
    const pi = await makePi();
    await factory(pi as never);
    const notify = vi.fn();
    const custom = vi.fn(async (makeComponent: ComponentFactory) => {
      const app = makeComponent({ requestRender: vi.fn() }, {}, {}, () => {});
      fillKeyGroup(app);
    });

    await pi.commands.get("failover")?.("", {
      mode: "tui",
      modelRegistry: {},
      thinkingLevel: "medium",
      ui: { notify, custom },
    });

    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(S.modelManager.keyGroupForm.saved, "info"),
    );
    expect(notify).not.toHaveBeenCalledWith(S.modelManager.keyGroupForm.saved, "warning");
  });

  it("keeps validation failures at warning severity", async () => {
    const pi = await makePi();
    await factory(pi as never);
    const notify = vi.fn();
    const custom = vi.fn(async (makeComponent: ComponentFactory) => {
      const app = makeComponent({ requestRender: vi.fn() }, {}, {}, () => {});
      app.handleInput("k");
      for (const character of "bad name") app.handleInput(character);
      app.handleInput(Key.ctrl("s"));
    });

    await pi.commands.get("failover")?.("", {
      mode: "tui",
      modelRegistry: {},
      thinkingLevel: "medium",
      ui: { notify, custom },
    });

    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(S.modelManager.keyGroupForm.invalidPrefix, "warning"),
    );
    expect(notify).not.toHaveBeenCalledWith(S.modelManager.keyGroupForm.invalidPrefix, "info");
  });
});
