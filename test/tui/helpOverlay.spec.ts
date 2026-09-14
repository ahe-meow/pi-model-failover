import { describe, expect, it } from "vitest";
import { HelpOverlay } from "../../src/tui/primitives/helpOverlay.js";

describe("HelpOverlay (C20)", () => {
  it("toggle flips and render fills the requested height", () => {
    const h = new HelpOverlay([
      {
        title: "Global",
        hints: [
          ["?", "help"],
          ["q", "quit"],
        ],
      },
    ]);
    expect(h.visible).toBe(false);
    h.toggle();
    expect(h.visible).toBe(true);
    const out = h.render(40, 12);
    expect(out).toHaveLength(12);
    expect(out[0]).toContain("Global");
    expect(out[1]).toContain("?");
  });
});
