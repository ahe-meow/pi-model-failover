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

const providerForSort = (id: string, multiplier?: number) => ({
  name: id,
  baseUrl: "https://relay.example/v1",
  api: "openai-completions" as const,
  models: models.providers.relay?.models.slice(0, 1) ?? [],
  ...(multiplier === undefined
    ? {}
    : { piModelFailover: { group: null, costMultiplier: multiplier } }),
});

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
  modelData: ModelsJson = models,
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
    models: () => modelData,
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
  it("opens list and detail filters from Kitty slash input", async () => {
    const { deps } = await makeHarness([
      chain("other"),
      chain("zz-chain", [target("first"), target("second")]),
    ]);
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    await tab.handleInput("\u001b[47;1u");
    await tab.handleInput("z");
    await tab.handleInput(Key.enter);
    expect(tab.render(78, 7).join("\n")).toContain("zz-chain");
    expect(tab.render(78, 7).join("\n")).not.toContain("other");

    await tab.handleInput(Key.enter);
    await tab.handleInput("\u001b[47;1u");
    for (const character of "second") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    expect(tab.render(78, 7).join("\n")).toContain("second/m");
    expect(tab.render(78, 7).join("\n")).not.toContain("first/m");
  });

  it.each([
    ["up", [Key.end, Key.up], "match-6/m"],
    ["down", [Key.home, Key.down], "match-1/m"],
    ["page up", [Key.end, Key.pageUp], "match-1/m"],
    ["page down", [Key.home, Key.pageDown], "match-6/m"],
    ["home", [Key.end, Key.home], "match-0/m"],
    ["end", [Key.home, Key.end], "match-7/m"],
  ])("navigates filtered Chain detail with $0", async (_name, movement, expected) => {
    const { deps } = await makeHarness([
      chain(
        "coding",
        Array.from({ length: 8 }, (_, index) => target(`match-${index}`)),
      ),
    ]);
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    await tab.handleInput(Key.enter);
    tab.render(78, 7);
    await tab.handleInput("/");
    for (const character of "match") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    for (const key of movement) await tab.handleInput(key);
    await tab.handleInput(Key.enter);

    expect(tab.render(78, 7).join("\n")).toContain(`Target ${expected}`);
  });

  it("keeps chain list and detail filter drafts at body height", async () => {
    const { deps } = await makeHarness([chain()]);
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    const listHeight = tab.render(78, 7).length;
    await tab.handleInput("/");
    expect(tab.render(78, 7)).toHaveLength(listHeight);
    await tab.handleInput(Key.escape);
    await tab.handleInput(Key.enter);
    const detailHeight = tab.render(78, 7).length;
    await tab.handleInput("/");
    expect(tab.render(78, 7)).toHaveLength(detailHeight);
  });

  it("filters the chain list display-only and preserves cancel and clear behavior", async () => {
    const { deps, config } = await makeHarness([chain("other"), chain("zz-chain")]);
    const update = vi.spyOn(config, "update");
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    await tab.handleInput("/");
    for (const character of "zz") await tab.handleInput(character);
    await tab.handleInput(Key.escape);
    let rendered = tab.render(78, 7).join("\n");
    expect(rendered).toContain("other");
    expect(rendered).toContain("zz-chain");

    await tab.handleInput("/");
    for (const character of "ZZ") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    rendered = tab.render(78, 7).join("\n");
    expect(rendered).toContain("zz-chain");
    expect(rendered).not.toContain("other");
    expect(update).not.toHaveBeenCalled();

    await tab.handleInput(Key.escape);
    expect(tab.render(78, 7).join("\n")).toContain("other");
  });

  it("filters chain targets and keeps the selected target mapped to its source", async () => {
    const { deps, config } = await makeHarness([
      chain("coding", [target("first"), target("second"), target("third")]),
    ]);
    const update = vi.spyOn(config, "update");
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    await tab.handleInput(Key.enter);
    await tab.handleInput("/");
    for (const character of "SECOND") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    let rendered = tab.render(78, 7).join("\n");
    expect(rendered).toContain("second/m");
    expect(rendered).not.toContain("first/m");
    expect(update).not.toHaveBeenCalled();

    await tab.handleInput(Key.enter);
    expect(tab.render(78, 7).join("\n")).toContain("Target second/m");
    await tab.handleInput(Key.escape);
    await tab.handleInput(Key.escape);
    rendered = tab.render(78, 7).join("\n");
    expect(rendered).toContain("first/m");
  });

  it("keeps a filtered target selected after moving across a hidden target", async () => {
    const { deps, config } = await makeHarness([
      chain("coding", [target("match-a"), target("hidden"), target("match-b")]),
    ]);
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    await tab.handleInput(Key.enter);
    await tab.handleInput("/");
    for (const character of "match") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    await tab.handleInput("J");

    expect(config.get().chains[0]?.targets).toEqual([
      target("hidden"),
      target("match-a"),
      target("match-b"),
    ]);
    await tab.handleInput(Key.enter);
    expect(tab.render(78, 7).join("\n")).toContain("Target match-a/m");
  });

  it("renders chains and opens detail on Enter, then returns with Esc", async () => {
    const { deps } = await makeHarness([chain(), chain("review")]);
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    expect(tab.render(78, 7)).toHaveLength(8);
    expect(tab.render(78, 7).join("\n")).toContain("coding");
    expect(tab.render(78, 7).join("\n")).toContain("\x1b[92mok\x1b[39m");

    await tab.handleInput(Key.enter);
    expect(tab.render(78, 7).join("\n")).toContain("relay/m");
    await tab.handleInput(Key.escape);
    expect(tab.render(78, 7)).toHaveLength(8);
    expect(tab.helpTitle()).toBe(S.tabs[1]);
  });

  it("uses the selected or current Chain with p", async () => {
    const { deps } = await makeHarness([chain(), chain("review")]);
    const useModel = vi.fn(async () => {});
    Object.assign(deps, { useModel });
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    await tab.handleInput("p");
    expect(useModel).toHaveBeenCalledWith("failover", "coding");

    await tab.handleInput(Key.down);
    await tab.handleInput("p");
    expect(useModel).toHaveBeenLastCalledWith("failover", "review");

    await tab.handleInput(Key.enter);
    await tab.handleInput("p");
    expect(useModel).toHaveBeenLastCalledWith("failover", "review");
  });

  it("adds a chain through the validated id/name form", async () => {
    const { deps, config, registrar } = await makeHarness([]);
    const tab = createTab(deps);

    tab.handleInput("a");
    await tab.handleInput(Key.down);
    await tab.handleInput(Key.enter);
    expect(deps.notify).not.toHaveBeenCalled();
    for (const character of "New Chain") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    await tab.handleInput(Key.ctrl("s"));

    expect(config.get().chains).toMatchObject([
      { id: "new-chain", name: "New Chain", targets: [] },
    ]);
    expect(registrar.syncFailover).toHaveBeenCalledTimes(1);
  });

  it("renames the selected chain ID and name in place, preserving targets and registration", async () => {
    const { deps, config, registrar } = await makeHarness([
      chain("coding", [target("relay"), target("backup")]),
      chain("review"),
    ]);
    const tab = createTab(deps);

    await tab.handleInput("n");
    for (const _character of "coding") await tab.handleInput(Key.backspace);
    for (const character of "primary") await tab.handleInput(character);
    await tab.handleInput(Key.down);
    for (const _character of "Coding") await tab.handleInput(Key.backspace);
    for (const character of "Primary") await tab.handleInput(character);
    await tab.handleInput(Key.ctrl("s"));

    expect(config.get().chains.map(({ id }) => id)).toEqual(["primary", "review"]);
    expect(config.get().chains[0]?.targets).toEqual([target("relay"), target("backup")]);
    const synced = registrar.syncFailover.mock.calls.at(-1)?.[0] as Chain[] | undefined;
    expect(synced?.map(({ id }) => id)).toEqual(["primary", "review"]);
  });

  it("restores the renamed Chain's visible selection after filtering", async () => {
    const { deps, config } = await makeHarness([
      chain("hidden"),
      chain("match-a"),
      chain("match-b"),
    ]);
    const tab = createTab(deps);

    await tab.handleInput("/");
    for (const character of "match") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    await tab.handleInput("n");
    for (const _character of "match-a") await tab.handleInput(Key.backspace);
    for (const character of "match-renamed") await tab.handleInput(character);
    await tab.handleInput(Key.down);
    for (const _character of "Match-a") await tab.handleInput(Key.backspace);
    for (const character of "Renamed") await tab.handleInput(character);
    await tab.handleInput(Key.ctrl("s"));

    expect(config.get().chains.map(({ id }) => id)).toEqual(["hidden", "match-renamed", "match-b"]);
    tab.render(78, 7);
    await tab.handleInput(Key.enter);
    expect(tab.render(78, 7).join("\n")).toContain("match-renamed → failover/match-renamed");
  });

  it("rejects a duplicate chain ID during rename", async () => {
    const { deps, config, registrar } = await makeHarness([chain("coding"), chain("review")]);
    const tab = createTab(deps);

    await tab.handleInput("n");
    for (const _character of "coding") await tab.handleInput(Key.backspace);
    for (const character of "review") await tab.handleInput(character);
    await tab.handleInput(Key.down);
    await tab.handleInput(Key.enter);
    await tab.handleInput(Key.ctrl("s"));

    expect(deps.notify).toHaveBeenCalledWith(S.chains.form.duplicateId);
    expect(config.get().chains.map(({ id }) => id)).toEqual(["coding", "review"]);
    expect(registrar.syncFailover).not.toHaveBeenCalled();
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

  it("moves targets down with lowercase j and back up with lowercase k", async () => {
    const { deps, config } = await makeHarness([
      chain("coding", [target("first"), target("second")]),
    ]);
    const tab = createTab(deps);

    await tab.handleInput(Key.enter);
    await tab.handleInput("j");
    expect(config.get().chains[0]?.targets.map(({ provider }) => provider)).toEqual([
      "second",
      "first",
    ]);
    await tab.handleInput("k");
    expect(config.get().chains[0]?.targets.map(({ provider }) => provider)).toEqual([
      "first",
      "second",
    ]);
  });

  it("sorts all Chain targets by multiplier in both directions", async () => {
    const sortModels: ModelsJson = {
      providers: {
        high: providerForSort("high", 2),
        "tied-first": providerForSort("tied-first", 0.5),
        "tied-second": providerForSort("tied-second", 0.5),
        missing: providerForSort("missing"),
      },
    };
    const { deps, config, registrar } = await makeHarness(
      [
        chain("coding", [
          target("high"),
          target("tied-first"),
          target("tied-second"),
          target("missing"),
        ]),
      ],
      {},
      sortModels,
    );
    const tab = createTab(deps);

    await tab.handleInput(Key.enter);
    await tab.handleInput("s");
    expect(config.get().chains[0]?.targets.map(({ provider }) => provider)).toEqual([
      "tied-first",
      "tied-second",
      "missing",
      "high",
    ]);
    expect(registrar.syncFailover).toHaveBeenCalledTimes(1);

    await tab.handleInput("s");
    expect(config.get().chains[0]?.targets.map(({ provider }) => provider)).toEqual([
      "high",
      "missing",
      "tied-first",
      "tied-second",
    ]);
    expect(registrar.syncFailover).toHaveBeenCalledTimes(2);
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

  it("resets every target in a chain after lowercase r confirmation", async () => {
    const failed: TargetState = {
      consecutiveFailures: 2,
      cooldownLevel: 2,
      cooldownUntil: new Date(60_000).toISOString(),
      manualRecovery: false,
      lastFailure: { ts: new Date(0).toISOString(), reason: "http-503" },
    };
    const { deps, state, history } = await makeHarness(
      [chain("coding", [target("first"), target("second")])],
      { "first/m": failed, "second/m": failed },
    );
    const tab = createTab(deps);

    await tab.handleInput("r");
    expect(tab.render(78, 7).join("\n")).toContain("Reset 2 targets in coding?");
    expect(await state.read()).toEqual({ "first/m": failed, "second/m": failed });

    await tab.handleInput(Key.left);
    await tab.handleInput(Key.enter);

    expect(await state.read()).toEqual({
      "first/m": reset(),
      "second/m": reset(),
    });
    expect(history.append).toHaveBeenCalledTimes(2);
    expect(history.append.mock.calls.map(([event]) => event.reason)).toEqual(["manual", "manual"]);
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

  it("renders only number, target, multiplier, and status in the target header", async () => {
    const { deps } = await makeHarness([chain("coding", [target("first"), target("second")])]);
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    await tab.handleInput(Key.enter);
    const rendered = tab.render(100, 7).join("\n");

    expect(rendered).toContain(S.chains.targetLabels.target);
    expect(rendered).toContain(S.chains.targetLabels.multiplier);
    expect(rendered).toContain(S.chains.targetLabels.status);
    expect(rendered).not.toContain("Retries");
    expect(rendered).not.toContain("TTFT");
    expect(rendered).toContain("first/m");
  });

  it("keeps the target reference readable in a narrow terminal", async () => {
    const { deps } = await makeHarness([
      chain("coding", [target("long-provider-name"), target("second")]),
    ]);
    const tab = createTab(deps);
    await vi.waitFor(() => expect(deps.state.read).toHaveBeenCalled());

    await tab.handleInput(Key.enter);
    const row = tab.render(60, 7).find((line) => line.includes("long-provider-name"));

    expect(row).toBeDefined();
    expect(row).toContain("long-provider-name");
  });
});
