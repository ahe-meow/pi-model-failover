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
      ttftAction: "cooldown-only",
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
