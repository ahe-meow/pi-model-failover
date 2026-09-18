import { Key, stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../../src/config/configStore.js";
import type { SharedState } from "../../src/config/sharedState.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import type { ModelsJson } from "../../src/domain/types.js";
import type { HistoryLog } from "../../src/history/historyLog.js";
import { S } from "../../src/strings.js";
import { type AppDeps, createApp } from "../../src/tui/app.js";
import { MemoryFs } from "../fakes/memoryFs.js";

function makeAppDeps(config: ConfigStore, overrides: Partial<AppDeps> = {}): AppDeps {
  let models: ModelsJson = overrides.initialModels ?? {
    providers: {
      relay: {
        name: "Relay",
        baseUrl: "https://relay.example/v1",
        api: "openai-completions",
        models: [],
        piModelFailover: { group: "kg-test", costMultiplier: 0.1 },
      },
    },
  };
  const modelsFile = overrides.modelsFile ?? {
    read: async () => structuredClone(models),
    update: async (fn: (value: ModelsJson) => ModelsJson) => {
      models = fn(structuredClone(models));
      return structuredClone(models);
    },
  };
  return {
    config,
    modelsFile,
    initialModels: structuredClone(models),
    registrar: { syncOwned: () => {}, syncFailover: () => {} },
    state: {
      read: async () => ({}),
      update: async () => {},
      isMemoryMode: () => false,
      flush: async () => {},
    } as unknown as SharedState,
    history: {
      append: async () => {},
      list: async () => ({ events: [], dropped: 0 }),
      flush: async () => {},
    } as unknown as HistoryLog,
    models: () => structuredClone(models),
    sessionId: "test-session",
    createChainId: () => "chain-test",
    notify: () => {},
    now: () => "2026-09-09T00:00:00.000Z",
    createKeyGroupId: () => "kg-test",
    fetch: globalThis.fetch,
    runtimeFactory: async () => ({ getModels: () => [] }),
    memoryMode: () => false,
    countTargets: () =>
      config.get().chains.reduce((count, chain) => count + chain.targets.length, 0),
    resetAll: async () => 0,
    close: () => {},
    ...overrides,
  };
}

const mk = async (overrides: Partial<AppDeps> = {}) => {
  const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
  let closed = false;
  const app = createApp(
    makeAppDeps(config, {
      ...overrides,
      close: () => {
        closed = true;
      },
    }),
  );
  return { app, config, closed: () => closed };
};

describe("app frame (C19, C20)", () => {
  it("height = 4 fixed + listRows + hint lines on every tab", async () => {
    const { app } = await mk();
    for (const k of ["1", "2", "3", "4"]) {
      app.handleInput(k);
      const h = app.render(78).length;
      expect(h === 4 + 7 + 1 || h === 4 + 7 + 2).toBe(true);
    }
  });

  it("shows memory mode in the app header", async () => {
    const { app } = await mk({ memoryMode: () => true });
    expect(app.render(78)[0]).toContain(S.memoryMode);
  });
  it("keeps frame height when Settings reset confirmation opens", async () => {
    const { app } = await mk();
    app.handleInput("4");
    const normalHeight = app.render(78).length;
    for (let i = 0; i < 6; i++) app.handleInput(Key.down);
    app.handleInput(Key.enter);

    const confirmation = app.render(78);
    expect(confirmation.join("\n")).toContain(S.resetAllConfirm(0).slice(0, 5));
    expect(confirmation).toHaveLength(normalHeight);
  });

  it("C1-C6: Model Manager is the first tab and keeps the fixed frame", async () => {
    const { app } = await mk({
      now: () => "2026-09-09T00:00:00.000Z",
      createKeyGroupId: () => "kg-test",
    });

    expect(app.render(78)[1]).toContain("[1 Model Manager]");
    expect(app.render(78).join("\n")).toContain("relay");
    expect(app.render(78)).toHaveLength(4 + 7 + 2);
    app.handleInput("k");
    expect(app.render(78).join("\n")).toContain(S.modelManager.keyGroupForm.title);
  });

  it("injects Chains as the second tab", async () => {
    const { app, config } = await mk();
    await config.update((value) => {
      value.chains = [
        { id: "coding", name: "Coding", targets: [{ provider: "relay", modelId: "m" }] },
      ];
    });

    app.handleInput("2");
    expect(app.render(78)[1]).toContain("[2 Chains]");
    expect(app.render(78).join("\n")).toContain("coding");
  });
  it("Tab cycles, 2 jumps to Chains", async () => {
    const { app } = await mk();
    app.handleInput("2");
    expect(app.render(78)[1]).toContain("[2 Chains]");
    app.handleInput(Key.tab);
    expect(app.render(78)[1]).toContain("[3 History]");
    app.handleInput(Key.shift("tab"));
    expect(app.render(78)[1]).toContain("[2 Chains]");
  });

  it("Settings numeric fields capture digits 1-4 without changing tabs", async () => {
    for (const digit of ["1", "2", "3", "4"]) {
      const { app } = await mk();
      app.handleInput("4");
      app.handleInput(Key.down);
      app.handleInput(Key.backspace);
      app.handleInput(digit);
      const rendered = app.render(78);
      expect(rendered[1]).toContain(`[4 ${S.tabs[3]}]`);
      expect(rendered.join("\n")).toContain(
        `${S.settings.labels.ttftTimeoutSeconds} ${S.help.zeroDisables}${" ".repeat(4)}${60 + Number(digit)}`,
      );
    }
  });

  it("numeric tab shortcuts work from normal app context", async () => {
    const { app } = await mk();
    for (const digit of ["1", "2", "3", "4"]) {
      app.handleInput(digit);
      expect(app.render(78)[1]).toContain(`[${digit} ${S.tabs[Number(digit) - 1]}]`);
    }
  });

  it("? opens help, swallows keys, ? closes", async () => {
    const { app } = await mk();
    app.handleInput("?");
    expect(app.render(78).join("\n")).toContain("Global");
    app.handleInput("2");
    app.handleInput("?");
    expect(app.render(78)[1]).toContain("[1 Model Manager]");
  });

  it("q closes", async () => {
    const { app, closed } = await mk();
    app.handleInput("q");
    expect(closed()).toBe(true);
  });

  it("routes Kitty filter input before global shortcuts", async () => {
    const { app, closed } = await mk();

    app.handleInput("\u001b[47;1u");
    app.handleInput("\u001b[113;1u");
    app.handleInput("\u001b[63;1u");
    app.handleInput("\u001b[49;1u");

    expect(app.render(78).join("\n")).toContain(`${S.form.inputPrompt}: q?1${S.form.cursor}`);
    expect(app.render(78)[1]).toContain("[1 Model Manager]");
    expect(closed()).toBe(false);
  });

  it("keeps global shortcuts inside an active Settings form editor", async () => {
    const { app, closed } = await mk();

    app.handleInput("4");
    app.handleInput(Key.enter);
    app.handleInput("q");
    app.handleInput("?");
    app.handleInput(Key.tab);

    expect(app.render(78)[1]).toContain("[4 Settings]");
    expect(app.render(78).join("\n")).not.toContain("Global\n  Tab");
    expect(closed()).toBe(false);
  });

  it("keeps global shortcuts inside an active Catalog filter", async () => {
    const { app, config, closed } = await mk();
    await config.update((value) => {
      value.catalog = [
        {
          id: "model",
          reasoning: false,
          vision: false,
          contextWindow: 1000,
          maxTokens: 100,
          defaults: {},
        },
      ];
    });

    app.handleInput("1");
    app.handleInput("c");
    app.handleInput("/");
    app.handleInput("q");
    app.handleInput("?");
    app.handleInput("1");

    expect(app.render(78).join("\n")).toContain(`${S.form.inputPrompt}: q?1${S.form.cursor}`);
    expect(app.render(78)[1]).toContain("[1 Model Manager]");
    expect(closed()).toBe(false);
  });

  it("keeps global shortcuts inside an active History filter", async () => {
    const { app, closed } = await mk();

    app.handleInput("3");
    app.handleInput("/");
    app.handleInput("q");
    app.handleInput("?");
    app.handleInput("2");

    expect(app.render(78).join("\n")).toContain(`${S.form.inputPrompt}: q?2${S.form.cursor}`);
    expect(app.render(78)[1]).toContain("[3 History]");
    expect(closed()).toBe(false);
  });

  it("keeps global shortcuts inside an active Chains filter", async () => {
    const { app, closed } = await mk();

    app.handleInput("2");
    app.handleInput("/");
    app.handleInput("q");
    app.handleInput("?");
    app.handleInput("1");

    expect(app.render(78).join("\n")).toContain(`${S.form.inputPrompt}: q?1${S.form.cursor}`);
    expect(app.render(78)[1]).toContain("[2 Chains]");
    expect(closed()).toBe(false);
  });

  it("keeps top-level filter drafts at the normal body height", async () => {
    for (const tab of ["1", "2", "3"]) {
      const { app } = await mk();
      app.handleInput(tab);
      const normal = app.render(78).length;
      app.handleInput("/");
      expect(app.render(78)).toHaveLength(normal);
    }
  });

  it("listRows change resizes every tab", async () => {
    const { app, config } = await mk();
    await config.update((c) => {
      c.settings.listRows = 12;
    });
    app.handleInput("1");
    const h = app.render(78).length;
    expect(h === 4 + 12 + 1 || h === 4 + 12 + 2).toBe(true);
  });

  it("requests a TUI render when a settings save changes config", async () => {
    const requestRender = vi.fn();
    const { app, config } = await mk({ requestRender } as unknown as Partial<AppDeps>);

    await config.update((value) => {
      value.settings.listRows = 8;
    });

    app.render(78);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it("stops requesting renders after the app is disposed", async () => {
    const requestRender = vi.fn();
    const { app, config } = await mk({ requestRender });
    app.dispose?.();
    app.dispose?.();
    await config.update((value) => {
      value.settings.listRows = 8;
    });

    expect(requestRender).not.toHaveBeenCalled();
  });

  it("stops rebuilding the Settings form after app disposal", async () => {
    const { app, config } = await mk();
    app.dispose?.();
    app.dispose?.();
    await config.update((value) => {
      value.settings.serverQuality.enabled = false;
    });

    app.handleInput("4");
    const enabledRow = app
      .render(100)
      .map(stripTerminalSequences)
      .find((line) => line.includes(S.settings.labels.serverQualityEnabled));
    expect(config.get().settings.serverQuality.enabled).toBe(false);
    expect(enabledRow).toContain(S.settings.options.serverQuality.on);
  });

  it("requests a TUI render when a model-list save completes", async () => {
    const requestRender = vi.fn();
    let models: ModelsJson = {
      providers: {
        relay: {
          name: "Relay",
          baseUrl: "https://relay.example/v1",
          api: "openai-completions",
          models: [],
        },
      },
    };
    const update = vi.fn(async (fn: (value: ModelsJson) => ModelsJson) => {
      models = fn(structuredClone(models));
      return structuredClone(models);
    });
    const { app } = await mk({
      requestRender,
      initialModels: structuredClone(models),
      modelsFile: {
        read: async () => structuredClone(models),
        update,
      },
    });

    app.handleInput("d");
    app.handleInput(Key.left);
    app.handleInput(Key.enter);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(requestRender).toHaveBeenCalledTimes(1);
  });
});
