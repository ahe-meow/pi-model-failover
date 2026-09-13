import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../../src/config/configStore.js";
import type { SharedState } from "../../src/config/sharedState.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { reset } from "../../src/domain/cooldown.js";
import type { Clock } from "../../src/domain/ports.js";
import type {
  Chain,
  FailoverEvent,
  ModelsJson,
  TargetRef,
  TargetState,
} from "../../src/domain/types.js";
import { S } from "../../src/strings.js";
import { ChainsTab } from "../../src/tui/tabs/chains.js";
import { MemoryFs } from "../fakes/memoryFs.js";

interface TestChainsDeps {
  config: ConfigStore;
  models: () => ModelsJson;
  state: SharedState;
  history: { append: ReturnType<typeof vi.fn> };
  registrar: { syncFailover: ReturnType<typeof vi.fn> };
  notify: (message: string) => void;
  now: () => string;
  sessionId: string;
  createChainId: () => string;
}

const createTab = (deps: TestChainsDeps): ChainsTab => {
  const FutureChainsTab = ChainsTab as unknown as new (deps: TestChainsDeps) => ChainsTab;
  return new FutureChainsTab(deps);
};
const clock: Clock = { now: () => 0, sleep: async () => {} };
const target = (provider = "relay", modelId = "m") => ({ provider, modelId });
const chain = (id = "coding", targets = [target()]): Chain => ({
  id,
  name: id[0]?.toUpperCase() + id.slice(1),
  targets,
});
const models: ModelsJson = {
  providers: {
    relay: {
      name: "Relay",
      baseUrl: "https://relay.example/v1",
      api: "openai-completions",
      models: [
        {
          id: "m",
          name: "Relay model",
          reasoning: false,
          input: ["text"],
          contextWindow: 8_000,
          maxTokens: 1_000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  },
};

interface Harness {
  deps: TestChainsDeps;
  config: ConfigStore;
  state: SharedState;
  history: { append: ReturnType<typeof vi.fn> };
  registrar: { syncFailover: ReturnType<typeof vi.fn> };
}

async function makeHarness(
  chains: Chain[] = [chain()],
  initialState: Record<TargetRef, TargetState> = {},
): Promise<Harness> {
  const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
  await config.update((value) => {
    value.chains = structuredClone(chains);
  });
  let currentState = structuredClone(initialState);
  const state = {
    read: vi.fn(async () => structuredClone(currentState)),
    update: vi.fn(async (fn: (targets: Record<TargetRef, TargetState>) => void) => {
      const next = structuredClone(currentState);
      fn(next);
      currentState = next;
    }),
  } as unknown as SharedState;
  const history = { append: vi.fn(async (_event: FailoverEvent) => {}) };
  const registrar = { syncFailover: vi.fn() };
  const deps: TestChainsDeps = {
    config,
    models: () => models,
    state,
    history,
    registrar,
    notify: vi.fn(),
    now: () => new Date(clock.now()).toISOString(),
    sessionId: "session-1",
    createChainId: () => "new-chain",
  };
  return { deps, config, state, history, registrar };
}

describe("ChainsTab", () => {
  it("renders chains and opens detail on Enter, then returns with Esc", async () => {
    const { deps } = await makeHarness([chain(), chain("review")]);
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    expect(tab.render(78, 7)).toHaveLength(8);
    expect(tab.render(78, 7).join("\n")).toContain("coding");

    await tab.handleInput(Key.enter);
    expect(tab.render(78, 7).join("\n")).toContain("relay/m");
    await tab.handleInput(Key.escape);
    expect(tab.render(78, 7)).toHaveLength(8);
    expect(tab.helpTitle()).toBe(S.tabs[1]);
  });

  it("adds a chain through the validated id/name form", async () => {
    const { deps, config, registrar } = await makeHarness([]);
    const tab = createTab(deps);

    tab.handleInput("a");
    await tab.handleInput(Key.down);
    await tab.handleInput(Key.enter);
    for (const character of "New Chain") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    await tab.handleInput(Key.enter);

    expect(config.get().chains).toMatchObject([
      { id: "new-chain", name: "New Chain", targets: [] },
    ]);
    expect(registrar.syncFailover).toHaveBeenCalledTimes(1);
  });

  it("renames the selected chain without changing its id", async () => {
    const { deps, config } = await makeHarness([chain()]);
    const tab = createTab(deps);

    tab.handleInput("r");
    for (let index = 0; index < "Coding".length; index++) await tab.handleInput(Key.backspace);
    for (const character of "Primary") await tab.handleInput(character);
    await tab.handleInput(Key.enter);

    expect(config.get().chains[0]).toMatchObject({ id: "coding", name: "Primary" });
  });

  it("deletes a chain only after confirmation", async () => {
    const { deps, config, registrar } = await makeHarness([chain()]);
    const tab = createTab(deps);

    tab.handleInput("d");
    expect(config.get().chains).toHaveLength(1);
    expect(tab.render(78, 7).join("\n")).toContain("coding");
    await tab.handleInput(Key.left);
    await tab.handleInput(Key.enter);

    expect(config.get().chains).toEqual([]);
    expect(registrar.syncFailover).toHaveBeenCalledTimes(1);
  });

  it("resets a target and appends one manual event", async () => {
    const failed: TargetState = {
      consecutiveFailures: 2,
      cooldownLevel: 2,
      cooldownUntil: new Date(60_000).toISOString(),
      manualRecovery: false,
      lastFailure: { ts: new Date(0).toISOString(), reason: "http-503" },
    };
    const { deps, state, history } = await makeHarness([chain()], { "relay/m": failed });
    const tab = createTab(deps);

    await tab.handleInput(Key.enter);
    await tab.handleInput("r");

    expect(await state.read()).toEqual({ "relay/m": reset() });
    expect(history.append).toHaveBeenCalledWith({
      ts: new Date(0).toISOString(),
      sessionId: "session-1",
      requestSeq: 0,
      from: "relay/m",
      to: null,
      reason: "manual",
      elapsedMs: 0,
    });
  });

  it("moves targets down with J and back up with K", async () => {
    const { deps, config } = await makeHarness([
      chain("coding", [target("first"), target("second")]),
    ]);
    const tab = createTab(deps);

    await tab.handleInput(Key.enter);
    await tab.handleInput("J");
    expect(config.get().chains[0]?.targets.map(({ provider }) => provider)).toEqual([
      "second",
      "first",
    ]);
    await tab.handleInput("K");
    expect(config.get().chains[0]?.targets.map(({ provider }) => provider)).toEqual([
      "first",
      "second",
    ]);
  });

  it("resets every target in a chain after R confirmation", async () => {
    const { deps, state, history } = await makeHarness([
      chain("coding", [target("first"), target("second")]),
    ]);
    const tab = createTab(deps);

    await tab.handleInput(Key.enter);
    await tab.handleInput(Key.escape);
    tab.handleInput("R");
    await tab.handleInput(Key.left);
    await tab.handleInput(Key.enter);

    expect(await state.read()).toEqual({
      "first/m": reset(),
      "second/m": reset(),
    });
    expect(history.append).toHaveBeenCalledTimes(2);
    expect(history.append.mock.calls.every(([event]) => event.reason === "manual")).toBe(true);
  });

  it("keeps list and detail bodies at listRows plus one header line", async () => {
    for (const listRows of [5, 7, 20]) {
      const { deps } = await makeHarness([chain()]);
      const tab = createTab(deps);
      expect(tab.render(78, listRows)).toHaveLength(listRows + 1);
      await tab.handleInput(Key.enter);
      expect(tab.render(78, listRows)).toHaveLength(listRows + 1);
    }
  });
});
