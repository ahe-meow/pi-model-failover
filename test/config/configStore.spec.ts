import { describe, expect, it } from "vitest";
import { ConfigStore, DEFAULT_SETTINGS } from "../../src/config/configStore.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { MemoryFs } from "../fakes/memoryFs.js";

describe("ConfigStore", () => {
  it("defaults", async () => {
    const store = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");

    expect(store.get().settings).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      listRows: 7,
      ttftTimeoutSeconds: 60,
      serverQuality: { enabled: true, ttft: true, noProgress: true },
      maxRetries: 5,
      errorHandlingMode: "smart",
      noProgressTimeoutSeconds: 90,
      reasoningEffort: "inherit",
      modelParameters: {},
    });
    expect(store.get().catalog).toEqual([]);
    expect(store.get().chains).toEqual([]);
    expect(store.get().keyGroups).toEqual([]);
  });

  it("update persists to /d/config.json with 0600 and fires onChange once", async () => {
    const fs = new MemoryFs();
    const store = await ConfigStore.open(fs, new WriteQueue(), "/d");
    let changes = 0;
    store.onChange(() => changes++);

    await store.update((config) => {
      config.settings.listRows = 12;
    });

    expect(changes).toBe(1);
    expect(fs.modes.get("/d/config.json")).toBe(0o600);
    expect(JSON.parse(fs.files.get("/d/config.json") ?? "null").settings.listRows).toBe(12);
  });

  it("persists a migrated v1 config immediately while preserving unknown data", async () => {
    const fs = new MemoryFs();
    fs.files.set(
      "/d/config.json",
      JSON.stringify({
        version: 1,
        settings: {
          listRows: 7,
          ttftTimeoutSeconds: 60,
          ttftAction: "cooldown-only",
          maxRetries: 5,
          errorHandlingMode: "smart",
          noProgressTimeoutSeconds: 90,
          reasoningEffort: "inherit",
          modelParameters: {},
          unknownSetting: { keep: true },
        },
        catalog: [],
        keyGroups: [],
        chains: [
          {
            id: "c",
            name: "C",
            unknownChain: true,
            targets: [
              {
                provider: "p",
                modelId: "m",
                ttftAction: "abort",
                unknownTarget: { keep: true },
              },
            ],
          },
        ],
        unknownRoot: { keep: true },
      }),
    );

    await ConfigStore.open(fs, new WriteQueue(), "/d");

    const persisted = JSON.parse(fs.files.get("/d/config.json") ?? "null");
    expect(persisted).toMatchObject({
      version: 2,
      settings: {
        serverQuality: { enabled: true, ttft: true, noProgress: true },
        unknownSetting: { keep: true },
      },
      chains: [
        {
          unknownChain: true,
          targets: [{ unknownTarget: { keep: true } }],
        },
      ],
      unknownRoot: { keep: true },
    });
    expect(persisted.settings).not.toHaveProperty("ttftAction");
    expect(persisted.chains[0].targets[0]).not.toHaveProperty("ttftAction");
  });

  it("deep-merges v2 defaults while preserving unknown fields and false values", async () => {
    const fs = new MemoryFs();
    fs.files.set(
      "/d/config.json",
      JSON.stringify({
        version: 2,
        settings: {
          listRows: 8,
          serverQuality: { enabled: false, unknownSetting: "keep" },
          unknownSetting: { keep: true },
        },
        catalog: [],
        keyGroups: [],
        chains: [
          {
            id: "c",
            name: "C",
            unknownChain: true,
            targets: [{ provider: "p", modelId: "m", unknownTarget: 1 }],
          },
        ],
        unknownRoot: [1],
      }),
    );

    const store = await ConfigStore.open(fs, new WriteQueue(), "/d");
    expect(store.get().settings.serverQuality).toEqual({
      enabled: false,
      ttft: true,
      noProgress: true,
      unknownSetting: "keep",
    });
    expect((store.get().settings as unknown as Record<string, unknown>).unknownSetting).toEqual({
      keep: true,
    });
    expect(store.get().chains[0]).toMatchObject({ unknownChain: true });
    expect(store.get().chains[0]?.targets[0]).toMatchObject({ unknownTarget: 1 });
    expect(store.get().unknownRoot).toEqual([1]);
  });

  it("preserves explicit false server quality values on update", async () => {
    const fs = new MemoryFs();
    fs.files.set(
      "/d/config.json",
      JSON.stringify({
        version: 2,
        settings: {
          serverQuality: { enabled: false, ttft: false, noProgress: false },
        },
        catalog: [],
        keyGroups: [],
        chains: [],
      }),
    );
    const store = await ConfigStore.open(fs, new WriteQueue(), "/d");
    await store.update(() => {});
    expect(store.get().settings.serverQuality).toEqual({
      enabled: false,
      ttft: false,
      noProgress: false,
    });
  });
  it("rejects listRows outside 5-20 and restores state", async () => {
    const store = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");

    await expect(
      store.update((config) => {
        config.settings.listRows = 4;
      }),
    ).rejects.toThrow(/listRows/);
    await expect(
      store.update((config) => {
        config.settings.listRows = 21;
      }),
    ).rejects.toThrow(/listRows/);
    expect(store.get().settings.listRows).toBe(7);
  });
});
