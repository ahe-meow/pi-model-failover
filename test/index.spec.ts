import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../src/adapters/modelsJson.js";
import { nodeFs } from "../src/adapters/nodeFs.js";
import { ConfigStore } from "../src/config/configStore.js";
import { WriteQueue } from "../src/config/writeQueue.js";
import type {
  Chain,
  FailoverEvent,
  ModelNode,
  ModelsJson,
  ProviderNode,
} from "../src/domain/types.js";
import { toPiProviderConfig } from "../src/index.js";
import { S } from "../src/strings.js";
import { FakePi } from "./fakes/fakePi.js";

const mockRuntime = vi.hoisted(() => ({
  agentDir: "",
  models: [] as unknown[],
  createOptions: [] as unknown[],
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  getAgentDir: () => mockRuntime.agentDir,
  ModelRuntime: {
    create: vi.fn(async (options: unknown) => {
      mockRuntime.createOptions.push(options);
      return { getModels: () => mockRuntime.models };
    }),
  },
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

const chainWithModel = (id = "coding", name = id): Chain => ({
  id,
  name,
  targets: [{ provider: "relay", modelId: "m" }],
});

const ownedProvider = (id: string, providerModels: ModelNode[] = []): ProviderNode => ({
  name: id,
  baseUrl: `https://${id}.example/v1`,
  api: "openai-completions",
  models: providerModels,
  piModelFailover: { group: "kg-test", costMultiplier: 0.1 },
});

const ownedModels = (ids: string[]): ModelsJson => ({
  providers: Object.fromEntries(ids.map((id) => [id, ownedProvider(id)])),
});

interface FactoryOptions {
  pi?: FakePi;
  offlineModels?: unknown[];
  models?: ModelsJson;
  now?: () => string;
  createKeyGroupId?: () => string;
  chains?: Chain[];
}

async function makeFactory(options: FactoryOptions = {}) {
  mockRuntime.agentDir = mkdtempSync(join(tmpdir(), "pmf-agent-"));
  mockRuntime.models = options.offlineModels ?? [];
  mockRuntime.createOptions = [];
  const { default: factory } = await import("../src/index.js");
  const pi = options.pi ?? new FakePi();
  const modelsFile = new ModelsJsonFile(
    nodeFs,
    new WriteQueue(),
    join(mockRuntime.agentDir, "models.json"),
  );
  await modelsFile.update(() => structuredClone(options.models ?? { providers: {} }));
  await nodeFs.mkdir(join(mockRuntime.agentDir, "pi-model-failover"), 0o700);
  const config = await ConfigStore.open(
    nodeFs,
    new WriteQueue(),
    join(mockRuntime.agentDir, "pi-model-failover"),
  );
  if (options.chains !== undefined) {
    await config.update((value) => {
      value.chains = structuredClone(options.chains ?? []);
    });
  }
  return { factory, modelsFile, config, pi, agentDir: mockRuntime.agentDir };
}

const fakeContext = () => ({}) as never;
const fakeContextWithRegistry = () => ({ modelRegistry: {} }) as never;

describe("extension entry", () => {
  it("registers /failover and session hooks; non-TUI mode notifies", async () => {
    const { factory, pi } = await makeFactory();
    await factory(pi as never);

    expect(pi.commands.has("failover")).toBe(true);
    expect(S.commandDescription).toBe("Manage providers, failover chains, history");
    expect(pi.commandDescriptions.get("failover")).toBe(S.commandDescription);
    expect(pi.handlers.has("session_start")).toBe(true);
    expect(pi.handlers.has("session_shutdown")).toBe(true);

    const notify = vi.fn();
    const command = pi.commands.get("failover");
    expect(command).toBeDefined();
    await command?.("", { mode: "rpc", ui: { notify, custom: vi.fn() } });
    expect(notify).toHaveBeenCalledWith(S.needsTui, "warning");
  });

  it("uses the installed four-argument custom factory and resolves when the app closes", async () => {
    const { factory, pi } = await makeFactory();
    await factory(pi as never);

    const done = vi.fn();
    const custom = vi.fn(
      async (
        makeComponent: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          finish: (result: unknown) => void,
        ) => unknown,
      ) => {
        const component = makeComponent({}, {}, {}, done) as {
          render: (width: number) => string[];
          handleInput: (data: string) => void;
          invalidate: () => void;
        };
        expect(component.render).toEqual(expect.any(Function));
        expect(component.invalidate).toEqual(expect.any(Function));
        component.handleInput("q");
      },
    );

    const command = pi.commands.get("failover");
    expect(command).toBeDefined();
    await command?.("", {
      mode: "tui",
      ui: { notify: vi.fn(), custom },
    });

    expect(custom).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("preserves a function-valued ProviderConfig stream callback", () => {
    const streamSimple = vi.fn();
    const config = {
      api: "pi-model-failover",
      baseUrl: "https://failover.invalid",
      apiKey: "unused",
      models: [],
      streamSimple,
    };

    expect(toPiProviderConfig(config)).toBe(config);
  });

  it("adds default six-level reasoning capability metadata at the Pi boundary", () => {
    expect(
      toPiProviderConfig({
        name: "relay",
        models: [{ ...modelNode, reasoning: true }],
      }),
    ).toMatchObject({
      models: [{ thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: null } }],
    });
  });

  it("preserves Pi boolean authHeader when adapting provider config", () => {
    expect(toPiProviderConfig({ name: "relay", authHeader: true, models: [] })).toMatchObject({
      authHeader: true,
    });
  });

  it("registers failover models at factory time and refreshes them on session_start", async () => {
    const pi = new FakePi();
    const initialModels: ModelsJson = {
      providers: { relay: ownedProvider("relay", [modelNode]) },
    };
    const { factory, modelsFile } = await makeFactory({
      pi,
      models: initialModels,
      chains: [chainWithModel()],
    });
    await factory(pi as never);

    expect(pi.providers.get("failover")).toMatchObject({
      models: [{ id: "coding", name: "coding" }],
      streamSimple: expect.any(Function),
    });

    await modelsFile.update((models) => {
      const relay = models.providers.relay;
      if (relay === undefined) return models;
      return {
        ...models,
        providers: {
          ...models.providers,
          relay: { ...relay, models: [{ ...modelNode, contextWindow: 2000 }] },
        },
      };
    });
    await pi.handlers.get("session_start")?.[0]?.(
      { type: "session_start", reason: "reload" },
      fakeContextWithRegistry(),
    );

    expect(pi.providers.get("failover")).toMatchObject({
      models: [{ id: "coding", name: "coding", contextWindow: 2000 }],
    });
  });

  it("propagates a Model Manager Provider Model update to Chains and failover runtime", async () => {
    const pi = new FakePi();
    const { factory, config, modelsFile } = await makeFactory({
      pi,
      models: { providers: { relay: ownedProvider("relay") } },
      chains: [chainWithModel()],
    });
    await config.update((value) => {
      value.catalog = [
        {
          id: "m",
          reasoning: false,
          vision: false,
          contextWindow: 1000,
          maxTokens: 100,
          defaults: {},
        },
      ];
    });
    await factory(pi as never);

    let app: { handleInput(data: string): void; render(width: number): string[] } | undefined;
    const custom = vi.fn(
      async (
        makeComponent: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: (result: unknown) => void,
        ) => unknown,
      ) => {
        app = makeComponent({}, {}, {}, () => {}) as {
          handleInput(data: string): void;
          render(width: number): string[];
        };
      },
    );
    await pi.commands.get("failover")?.("", {
      mode: "tui",
      modelRegistry: {},
      thinkingLevel: "medium",
      ui: { notify: vi.fn(), custom },
    });
    expect(app).toBeDefined();

    app?.handleInput(Key.enter);
    app?.handleInput("a");
    app?.handleInput(Key.space);
    app?.handleInput(Key.enter);

    await vi.waitFor(async () => {
      const saved = await modelsFile.read();
      expect(saved.providers.relay?.models).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(pi.providers.get("failover")).toMatchObject({
        models: [{ id: "coding", contextWindow: 1000 }],
      });
    });

    app?.handleInput("2");
    app?.handleInput(Key.enter);
    expect(app?.render(120).join("\n")).toContain("ctx 1000");
  });
  it("C23: reset-all writes one manual event per configured Target", async () => {
    const pi = new FakePi();
    const initialModels: ModelsJson = {
      providers: {
        relay: ownedProvider("relay", [modelNode]),
        backup: ownedProvider("backup", [modelNode]),
      },
    };
    const { factory, agentDir } = await makeFactory({
      pi,
      models: initialModels,
      chains: [
        {
          id: "coding",
          name: "Coding",
          targets: [
            { provider: "relay", modelId: "m" },
            { provider: "backup", modelId: "m" },
          ],
        },
      ],
    });
    await factory(pi as never);

    let app: { handleInput(data: string): void } | undefined;
    const custom = vi.fn(
      async (
        makeComponent: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: (result: unknown) => void,
        ) => unknown,
      ) => {
        app = makeComponent({}, {}, {}, () => {}) as { handleInput(data: string): void };
      },
    );
    await pi.commands.get("failover")?.("", {
      mode: "tui",
      modelRegistry: {},
      thinkingLevel: "medium",
      ui: { notify: vi.fn(), custom },
    });
    expect(app).toBeDefined();

    app?.handleInput("4");
    for (let i = 0; i < 6; i++) app?.handleInput(Key.down);
    app?.handleInput(Key.enter);
    app?.handleInput(Key.left);
    app?.handleInput(Key.enter);

    const historyPath = join(agentDir, "pi-model-failover", "history.jsonl");
    await vi.waitFor(async () => {
      const text = await nodeFs.readText(historyPath);
      expect(text?.trim().split("\n")).toHaveLength(2);
    });
    const history = (await nodeFs.readText(historyPath))
      ?.trim()
      .split("\n")
      .map((line) => JSON.parse(line) as FailoverEvent);
    expect(history?.map((event) => event.from)).toEqual(["relay/m", "backup/m"]);
    expect(history?.every((event) => event.to === null && event.requestSeq === 0)).toBe(true);

    const state = JSON.parse(
      (await nodeFs.readText(join(agentDir, "pi-model-failover", "state.json"))) ?? "{}",
    ) as { targets: Record<string, { cooldownLevel: number; manualRecovery: boolean }> };
    expect(state.targets["relay/m"]).toEqual({
      consecutiveFailures: 0,
      cooldownLevel: 0,
      cooldownUntil: null,
      manualRecovery: false,
      lastFailure: null,
    });
  });

  it("C7: provider deletion cleans Chains and unregisters affected failover models", async () => {
    const pi = new FakePi();
    const { factory, agentDir } = await makeFactory({
      pi,
      models: { providers: { relay: ownedProvider("relay", [modelNode]) } },
      chains: [chainWithModel()],
    });
    await factory(pi as never);
    expect(pi.providers.has("failover")).toBe(true);

    let app: { handleInput(data: string): void } | undefined;
    const custom = vi.fn(
      async (
        makeComponent: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: (result: unknown) => void,
        ) => unknown,
      ) => {
        app = makeComponent({}, {}, {}, () => {}) as { handleInput(data: string): void };
      },
    );
    await pi.commands.get("failover")?.("", {
      mode: "tui",
      modelRegistry: {},
      thinkingLevel: "medium",
      ui: { notify: vi.fn(), custom },
    });
    app?.handleInput("d");
    app?.handleInput(Key.left);
    app?.handleInput(Key.enter);

    await vi.waitFor(async () => {
      expect(pi.providers.has("relay")).toBe(false);
      expect(pi.providers.has("failover")).toBe(false);
    });
    const config = JSON.parse(
      (await nodeFs.readText(join(agentDir, "pi-model-failover", "config.json"))) ?? "{}",
    ) as { chains: Chain[] };
    expect(config.chains[0]?.targets).toEqual([]);
  });

  it("C6: skips offline built-ins at factory time and re-syncs fresh models on session_start", async () => {
    const pi = new FakePi();
    const { factory, modelsFile } = await makeFactory({
      pi,
      offlineModels: [{ provider: "builtin" }],
      models: ownedModels(["builtin", "relay"]),
      now: () => "2026-09-09T00:00:00.000Z",
      createKeyGroupId: () => "kg-test",
    });
    await factory(pi as never);

    expect(mockRuntime.createOptions).toEqual([
      { modelsPath: null, refreshOnCreate: false, allowModelNetwork: false },
    ]);
    expect(pi.providers.has("builtin")).toBe(false);
    expect(pi.providers.has("relay")).toBe(true);
    expect(pi.providers.get("relay")).toEqual({
      name: "relay",
      baseUrl: "https://relay.example/v1",
      api: "openai-completions",
      models: [],
    });

    await modelsFile.update((models) => ({
      ...models,
      providers: { ...models.providers, later: ownedProvider("later") },
    }));
    const sessionStart = pi.handlers.get("session_start")?.[0];
    expect(sessionStart).toBeDefined();
    await sessionStart?.({ type: "session_start", reason: "reload" }, fakeContext());

    expect(pi.providers.has("later")).toBe(true);
    expect(pi.providers.has("builtin")).toBe(false);
  });

  it("renames a provider id across models.json, Chains, and cooldown state", async () => {
    const pi = new FakePi();
    const { factory, modelsFile, agentDir } = await makeFactory({
      pi,
      models: { providers: { relay: ownedProvider("relay", [modelNode]) } },
      chains: [chainWithModel()],
    });
    await factory(pi as never);
    const statePath = join(agentDir, "pi-model-failover", "state.json");
    await nodeFs.writeAtomic(
      statePath,
      JSON.stringify({
        version: 1,
        revision: 1,
        targets: {
          "relay/m": {
            consecutiveFailures: 1,
            cooldownLevel: 1,
            cooldownUntil: null,
            manualRecovery: true,
            lastFailure: { ts: new Date(0).toISOString(), reason: "http-503" },
          },
          "renamed/m": {
            consecutiveFailures: 9,
            cooldownLevel: 4,
            cooldownUntil: "2030-01-01T00:00:00.000Z",
            manualRecovery: false,
            lastFailure: { ts: new Date(0).toISOString(), reason: "http-429" },
          },
        },
      }),
      0o600,
    );
    const historyPath = join(agentDir, "pi-model-failover", "history.jsonl");
    const historicalRow = JSON.stringify({
      ts: new Date(0).toISOString(),
      sessionId: "old-session",
      requestSeq: 1,
      from: "relay/m",
      to: "other/m",
      reason: "http-503",
      elapsedMs: 5,
    });
    await nodeFs.writeAtomic(historyPath, `${historicalRow}\n`, 0o600);

    let app: { handleInput(data: string): void; render(width: number): string[] } | undefined;
    const custom = vi.fn(
      async (
        makeComponent: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: (result: unknown) => void,
        ) => unknown,
      ) => {
        app = makeComponent({}, {}, {}, () => {}) as {
          handleInput(data: string): void;
          render(width: number): string[];
        };
      },
    );
    await pi.commands.get("failover")?.("", {
      mode: "tui",
      modelRegistry: {},
      thinkingLevel: "medium",
      ui: { notify: vi.fn(), custom },
    });
    expect(app).toBeDefined();

    app?.handleInput(Key.enter);
    app?.handleInput("e");
    for (let index = 0; index < "relay".length; index++) app?.handleInput(Key.backspace);
    for (const character of "renamed") app?.handleInput(character);
    for (let index = 0; index < 7; index++) app?.handleInput(Key.down);
    app?.handleInput(Key.ctrl("s"));

    await vi.waitFor(async () => {
      expect((await modelsFile.read()).providers.renamed).toBeDefined();
    });
    await vi.waitFor(async () => {
      const raw = await nodeFs.readText(join(agentDir, "pi-model-failover", "config.json"));
      const saved = JSON.parse(raw ?? "{}") as { chains: Chain[] };
      expect(saved.chains[0]?.targets).toEqual([{ provider: "renamed", modelId: "m" }]);
    });
    await vi.waitFor(async () => {
      const raw = await nodeFs.readText(statePath);
      const saved = JSON.parse(raw ?? "{}") as { targets?: Record<string, unknown> };
      expect(Object.keys(saved.targets ?? {})).toEqual(["renamed/m"]);
      expect(saved.targets?.["relay/m"]).toBeUndefined();
      expect(saved.targets).toEqual({
        "renamed/m": {
          consecutiveFailures: 9,
          cooldownLevel: 4,
          cooldownUntil: "2030-01-01T00:00:00.000Z",
          manualRecovery: false,
          lastFailure: { ts: new Date(0).toISOString(), reason: "http-429" },
        },
      });
    });
    await vi.waitFor(() => {
      expect(pi.providers.has("relay")).toBe(false);
      expect(pi.providers.has("renamed")).toBe(true);
      expect(pi.providers.get("failover")).toMatchObject({
        models: [{ id: "coding" }],
      });
    });
    expect((await modelsFile.read()).providers.relay).toBeUndefined();
    expect(await nodeFs.readText(historyPath)).toBe(`${historicalRow}\n`);
  });
});
