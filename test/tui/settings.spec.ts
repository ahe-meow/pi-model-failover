import { Key, stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ConfigStore, LIST_ROWS_MIN } from "../../src/config/configStore.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { S } from "../../src/strings.js";
import { SettingsTab } from "../../src/tui/tabs/settings.js";
import { MemoryFs } from "../fakes/memoryFs.js";

describe("SettingsTab", () => {
  it("renders a fixed settings header aligned with every value", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    const lines = t.render(100, 12).map(stripTerminalSequences);
    const header = lines[1] ?? "";
    const tableHeader = S.settings.tableHeader.replace(/\s+/g, " ").trim();
    const valueColumn = header.indexOf("Value");
    const rows = [
      { label: `${S.settings.labels.listRows} ${S.help.listRowsHint}`, value: "7" },
      { label: `${S.settings.labels.ttftTimeoutSeconds} ${S.help.zeroDisables}`, value: "60" },
      { label: S.settings.labels.serverQualityEnabled, value: "[x] on" },
      { label: S.settings.labels.serverQualityTtft, value: "[x] on" },
      { label: S.settings.labels.serverQualityNoProgress, value: "[x] on" },
      { label: S.settings.labels.maxRetries, value: "5" },
      { label: S.settings.labels.errorHandlingMode, value: "[x] Smart" },
      { label: S.settings.labels.noProgressTimeoutSeconds, value: "90" },
    ];

    expect(header.replace(/\s+/g, " ").trim()).toBe(tableHeader);
    const maxLabelWidth = Math.max(...rows.map(({ label }) => label.length));
    expect(valueColumn).toBe(maxLabelWidth + 4);
    expect(lines).toHaveLength(13);
    for (const { label, value } of rows) {
      const line = lines.find((entry) => entry.startsWith(label));
      expect(line).toBeDefined();
      expect(line?.indexOf(value, label.length)).toBe(valueColumn);
    }
  });

  it("shows the Server Quality warning whenever effective global policy is disabled", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    await config.update((value) => {
      value.settings.serverQuality.enabled = false;
    });
    expect(t.render(100, 7).join("\n")).toContain(S.serverQualityDisabledWarning);

    await config.update((value) => {
      value.settings.serverQuality.enabled = true;
      value.settings.serverQuality.ttft = false;
      value.settings.serverQuality.noProgress = false;
    });
    expect(t.render(100, 7).join("\n")).toContain(S.serverQualityDisabledWarning);
  });

  it("saves all three global Server Quality switches", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    for (let index = 0; index < 3; index++) t.handleInput(Key.down);
    await t.handleInput(Key.enter);
    await t.handleInput(Key.down);
    await t.handleInput(Key.enter);
    await t.handleInput(Key.ctrl("s"));
    expect(config.get().settings.serverQuality.ttft).toBe(false);

    for (let index = 0; index < 4; index++) t.handleInput(Key.down);
    await t.handleInput(Key.enter);
    await t.handleInput(Key.down);
    await t.handleInput(Key.enter);
    await t.handleInput(Key.ctrl("s"));
    expect(config.get().settings.serverQuality.noProgress).toBe(false);

    for (let index = 0; index < 2; index++) t.handleInput(Key.down);
    await t.handleInput(Key.enter);
    await t.handleInput(Key.down);
    await t.handleInput(Key.enter);
    await t.handleInput(Key.ctrl("s"));
    expect(config.get().settings.serverQuality.enabled).toBe(false);
  });

  it("Enter edits a number before saving settings", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    t.handleInput(Key.enter);
    t.handleInput(Key.end);
    t.handleInput(Key.backspace);
    t.handleInput("2");
    t.handleInput("0");
    t.handleInput(Key.enter);
    for (let i = 0; i < 7; i++) t.handleInput(Key.down);
    await t.handleInput(Key.enter);
    expect(config.get().settings.listRows).toBe(7);
    await t.handleInput(Key.ctrl("s"));
    expect(config.get().settings.listRows).toBe(20);
  });

  it("renders settings labels and option values", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    const labels = [
      S.settings.labels.listRows,
      S.settings.labels.ttftTimeoutSeconds,
      S.settings.labels.serverQualityEnabled,
      S.settings.labels.serverQualityTtft,
      S.settings.labels.serverQualityNoProgress,
      S.settings.labels.maxRetries,
      S.settings.labels.errorHandlingMode,
      S.settings.labels.noProgressTimeoutSeconds,
    ];
    const initial = t.render(120, 12).join("\n");
    for (const label of labels) expect(initial).toContain(label);
    expect(initial).toContain(S.settings.options.serverQuality.on);
    expect(initial).toContain(S.settings.options.serverQuality.off);
  });

  it("keeps the focused final field visible at minimum listRows", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    await config.update((c) => {
      c.settings.listRows = LIST_ROWS_MIN;
    });
    const t = new SettingsTab(config, async () => 0);
    for (let i = 0; i < 7; i++) t.handleInput(Key.down);
    const rendered = t.render(78, LIST_ROWS_MIN);
    expect(rendered).toHaveLength(LIST_ROWS_MIN + 1);
    expect(rendered.join("\n")).toContain(S.settings.labels.noProgressTimeoutSeconds);
  });

  it("C23: reset confirmation names the affected target count", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const resetAll = vi.fn(async () => 2);
    const t = new SettingsTab(config, resetAll, () => 2);

    for (let i = 0; i < 8; i++) t.handleInput(Key.down);
    await t.handleInput(Key.enter);

    expect(t.render(78, 7).join("\n")).toContain(S.resetAllConfirm(2));
  });

  it("reset button asks for confirmation then calls resetAll", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const resetAll = vi.fn(async () => 3);
    const t = new SettingsTab(config, resetAll);
    for (let i = 0; i < 8; i++) t.handleInput(Key.down);
    t.handleInput(Key.enter);
    expect(t.render(78, 7).join("\n")).toContain(S.resetAllConfirm(0).slice(0, 5));
    t.handleInput(Key.left);
    await t.handleInput(Key.enter);
    expect(resetAll).toHaveBeenCalledTimes(1);
  });
});
