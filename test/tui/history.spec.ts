import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../../src/config/configStore.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { reset } from "../../src/domain/cooldown.js";
import type { FailoverEvent, TargetRef, TargetState } from "../../src/domain/types.js";
import { HistoryLog } from "../../src/history/historyLog.js";
import { type HistoryDeps, HistoryTab } from "../../src/tui/tabs/history.js";
import { MemoryFs } from "../fakes/memoryFs.js";

const event = (
  requestSeq: number,
  from: TargetRef,
  to: TargetRef | null,
  reason: FailoverEvent["reason"] = "http-503",
): FailoverEvent => ({
  ts: new Date(Date.UTC(2026, 8, 12, 12, requestSeq, 0)).toISOString(),
  sessionId: `session-${requestSeq}`,
  requestSeq,
  from,
  to,
  reason,
  elapsedMs: requestSeq * 100,
});

async function makeTab() {
  const history = await HistoryLog.open(new MemoryFs(), new WriteQueue(), "/history");
  const events = [
    event(1, "relay-a/coding", "relay-b/coding"),
    event(2, "relay-c/vision", null, "persistent"),
  ];
  for (const entry of events) await history.append(entry);

  const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/config");
  await config.update((value) => {
    value.chains = [
      { id: "coding", name: "Coding", targets: [{ provider: "relay-a", modelId: "coding" }] },
      { id: "vision", name: "Vision", targets: [{ provider: "relay-c", modelId: "vision" }] },
    ];
  });

  const states: Record<TargetRef, TargetState> = {};
  const updates: number[] = [];
  const state = {
    update: async (fn: (targets: Record<TargetRef, TargetState>) => void) => {
      updates.push(1);
      fn(states);
    },
  } as HistoryDeps["state"];
  const deps: HistoryDeps = {
    config,
    history,
    state,
    now: () => "2026-09-12T13:00:00.000Z",
    sessionId: "history-ui",
    notify: vi.fn(),
  };
  const tab = new HistoryTab(deps);
  await tab.refresh();
  return { tab, history, states, updates, deps, state };
}

describe("HistoryTab", () => {
  it("C18: lists newest first with derived chain and reset label", async () => {
    const { tab } = await makeTab();
    const rendered = tab.render(120, 7).join("\n");

    expect(rendered.indexOf("Vision")).toBeLessThan(rendered.indexOf("Coding"));
    expect(rendered).toContain("persistent");
    expect(rendered).toContain("relay-c/vision");
  });

  it("opens list and picker filters from Kitty slash input", async () => {
    const { tab } = await makeTab();

    await tab.handleInput("\u001b[47;1u");
    for (const character of "persistent") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    expect(tab.render(120, 7).join("\n")).toContain("persistent");
    expect(tab.render(120, 7).join("\n")).not.toContain("http-503");

    await tab.handleInput(Key.escape);
    await tab.handleInput("f");
    await tab.handleInput("\u001b[47;1u");
    for (const character of "vision") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    expect(tab.render(120, 7).join("\n")).toContain("Vision (vision)");
    expect(tab.render(120, 7).join("\n")).not.toContain("Coding (coding)");
  });

  it("keeps history list and picker filter drafts at body height", async () => {
    const { tab } = await makeTab();

    const listHeight = tab.render(120, 7).length;
    await tab.handleInput("/");
    expect(tab.render(120, 7)).toHaveLength(listHeight);
    await tab.handleInput(Key.escape);
    await tab.handleInput("f");
    const pickerHeight = tab.render(120, 7).length;
    await tab.handleInput("/");
    expect(tab.render(120, 7)).toHaveLength(pickerHeight);
  });

  it("filters history rows display-only with draft cancel and applied-query clear", async () => {
    const { tab, updates } = await makeTab();

    await tab.handleInput("/");
    for (const character of "PERSISTENT") await tab.handleInput(character);
    await tab.handleInput(Key.escape);
    let rendered = tab.render(120, 7).join("\n");
    expect(rendered).toContain("persistent");
    expect(rendered).toContain("http-503");

    await tab.handleInput("/");
    for (const character of "PERSISTENT") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    rendered = tab.render(120, 7).join("\n");
    expect(rendered).toContain("persistent");
    expect(rendered).not.toContain("http-503");
    expect(updates).toHaveLength(0);

    await tab.handleInput(Key.escape);
    expect(tab.render(120, 7).join("\n")).toContain("http-503");
  });

  it("does not open a hidden history row when a query matches nothing", async () => {
    const { tab, updates } = await makeTab();

    await tab.handleInput("/");
    for (const character of "missing") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    expect(tab.render(120, 7).join("\n")).not.toContain("Event details");

    await tab.handleInput(Key.enter);
    expect(tab.render(120, 7).join("\n")).not.toContain("requestSeq");
    expect(updates).toHaveLength(0);
  });

  it("filters the History chain picker before selecting its visible option", async () => {
    const { tab } = await makeTab();

    await tab.handleInput("f");
    await tab.handleInput("/");
    for (const character of "VISION") await tab.handleInput(character);
    await tab.handleInput(Key.enter);
    let rendered = tab.render(120, 7).join("\n");
    expect(rendered).toContain("Vision (vision)");
    expect(rendered).not.toContain("Coding (coding)");

    await tab.handleInput(Key.enter);
    rendered = tab.render(120, 7).join("\n");
    expect(rendered).toContain("relay-c/vision");
    expect(rendered).not.toContain("relay-a/coding");
  });

  it("C18: opens event details and returns to the list", async () => {
    const { tab } = await makeTab();

    await tab.handleInput(Key.enter);
    const detail = tab.render(120, 7).join("\n");
    expect(detail).toContain("session-2");
    expect(detail).toContain("requestSeq");
    expect(detail).toContain("2026-09-12T12:02:00.000Z");

    await tab.handleInput(Key.escape);
    expect(tab.render(120, 7).join("\n")).toContain("persistent");
  });

  it("C18: filters by chain and provider, then clears the filter", async () => {
    const { tab } = await makeTab();

    await tab.handleInput("f");
    await tab.handleInput(Key.enter);
    let rendered = tab.render(120, 7).join("\n");
    expect(rendered).toContain("Coding");
    expect(rendered).not.toContain("relay-c/vision");

    await tab.handleInput("c");
    await tab.handleInput("p");
    await tab.handleInput(Key.enter);
    rendered = tab.render(120, 7).join("\n");
    expect(rendered).toContain("relay-a/coding");
    expect(rendered).not.toContain("relay-c/vision");

    await tab.handleInput("c");
    expect(tab.render(120, 7).join("\n")).toContain("relay-c/vision");
  });

  it("C18: r resets the selected target and appends a manual event", async () => {
    const { tab, history, states, updates } = await makeTab();

    await tab.handleInput("r");
    expect(updates).toHaveLength(1);
    expect(states["relay-c/vision"]).toEqual(reset());
    const listed = await history.list();
    expect(listed.events[0]).toMatchObject({ from: "relay-c/vision", reason: "manual" });
    expect(tab.render(120, 7).join("\n")).toContain("reset");
  });

  it("C18: g re-reads history.jsonl", async () => {
    const { tab, history } = await makeTab();
    await history.append(event(3, "relay-a/newest", null, "network"));

    expect(tab.render(120, 7).join("\n")).not.toContain("relay-a/newest");
    await tab.handleInput("g");
    expect(tab.render(120, 7).join("\n")).toContain("relay-a/newest");
  });
});
