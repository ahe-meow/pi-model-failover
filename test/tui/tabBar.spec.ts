import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { TabBar } from "../../src/tui/primitives/tabBar.js";
import { theme } from "../../src/tui/primitives/theme.js";

describe("TabBar", () => {
  it("next and prev wrap", () => {
    const t = new TabBar(["A", "B", "C"]);
    t.prev();
    expect(t.active).toBe(2);
    t.next();
    expect(t.active).toBe(0);
  });

  it("uses semantic colors for the TUI hierarchy", () => {
    expect(theme.title("Title")).toContain("\x1b[96m");
    expect(theme.header("Header")).toContain("\x1b[94m");
    expect(theme.success("Saved")).toContain("\x1b[92m");
    expect(theme.warning("Careful")).toContain("\x1b[93m");
    expect(theme.danger("Failed")).toContain("\x1b[91m");
    expect(theme.muted("Hint")).toContain("\x1b[90m");
  });
  it("render marks the active tab with brackets and numbers", () => {
    const t = new TabBar(["A", "B"]);
    t.set(1);
    expect(stripTerminalSequences(t.render(40))).toBe(" 1 A  [2 B]");
    expect(t.render(40)).toContain("\x1b[96m[2 B]\x1b[39m");
  });
});
