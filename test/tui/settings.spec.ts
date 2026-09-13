import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ConfigStore, LIST_ROWS_MIN } from "../../src/config/configStore.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { S } from "../../src/strings.js";
import { SettingsTab } from "../../src/tui/tabs/settings.js";
import { MemoryFs } from "../fakes/memoryFs.js";

describe("SettingsTab", () => {
  it("shows the abort warning only when ttftAction is abort", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    expect(t.render(78, 7).join("\n")).not.toContain(S.abortWarning.slice(0, 20));
    t.handleInput(Key.down);
    t.handleInput(Key.down);
    t.handleInput(Key.enter);
    t.handleInput(Key.down);
    expect(t.render(78, 7).join("\n")).toContain(S.abortWarning.slice(0, 20));
    t.handleInput(Key.enter);
  });

  it("Enter edits a number before saving settings", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    t.handleInput(Key.enter);
    t.handleInput(Key.backspace);
    t.handleInput("9");
    t.handleInput(Key.enter);
    for (let i = 0; i < 5; i++) t.handleInput(Key.down);
    await t.handleInput(Key.enter);
    expect(config.get().settings.listRows).toBe(20);
  });

  it("renders settings labels and option values", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    const labels = [
      S.settings.labels.listRows,
      S.settings.labels.ttftTimeoutSeconds,
      S.settings.labels.ttftAction,
      S.settings.labels.maxRetries,
      S.settings.labels.errorHandlingMode,
      S.settings.labels.noProgressTimeoutSeconds,
    ];
    const initial = t.render(78, 7).join("\n");
    for (const label of labels) expect(initial).toContain(label);
    expect(initial).toContain(S.settings.options.ttftAction.cooldownOnly);

    t.handleInput(Key.down);
    t.handleInput(Key.down);
    t.handleInput(Key.enter);
    t.handleInput(Key.down);
    expect(t.render(78, 7).join("\n")).toContain(S.settings.options.ttftAction.abort);
    t.handleInput(Key.enter);
    t.handleInput(Key.down);
    t.handleInput(Key.down);
    t.handleInput(Key.enter);
    t.handleInput(Key.down);
    expect(t.render(78, 7).join("\n")).toContain(S.settings.options.errorHandlingMode.switch);
    t.handleInput(Key.enter);
  });

  it("keeps the focused sixth field visible at minimum listRows", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    await config.update((c) => {
      c.settings.listRows = LIST_ROWS_MIN;
    });
    const t = new SettingsTab(config, async () => 0);
    for (let i = 0; i < 5; i++) t.handleInput(Key.down);
    const rendered = t.render(78, LIST_ROWS_MIN);
    expect(rendered).toHaveLength(LIST_ROWS_MIN + 1);
    expect(rendered.join("\n")).toContain(S.settings.labels.noProgressTimeoutSeconds);
  });

  it("C23: reset confirmation names the affected target count", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const resetAll = vi.fn(async () => 2);
    const t = new SettingsTab(config, resetAll, () => 2);

    for (let i = 0; i < 6; i++) t.handleInput(Key.down);
    await t.handleInput(Key.enter);

    expect(t.render(78, 7).join("\n")).toContain(S.resetAllConfirm(2));
  });

  it("reset button asks for confirmation then calls resetAll", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const resetAll = vi.fn(async () => 3);
    const t = new SettingsTab(config, resetAll);
    for (let i = 0; i < 6; i++) t.handleInput(Key.down);
    t.handleInput(Key.enter);
    expect(t.render(78, 7).join("\n")).toContain(S.resetAllConfirm(0).slice(0, 5));
    t.handleInput(Key.left);
    await t.handleInput(Key.enter);
    expect(resetAll).toHaveBeenCalledTimes(1);
  });
});
