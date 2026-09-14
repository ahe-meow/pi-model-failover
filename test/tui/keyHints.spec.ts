import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderKeyHints } from "../../src/tui/primitives/keyHints.js";

describe("renderKeyHints", () => {
  it("fits one line when short", () => {
    const lines = renderKeyHints(
      [
        ["a", "add"],
        ["q", "quit"],
      ],
      40,
    ).map(stripTerminalSequences);
    expect(lines).toEqual([" a add  q quit"]);
  });

  it("wraps to two lines, never three", () => {
    const many: Array<[string, string]> = Array.from({ length: 12 }, (_, i) => [
      `k${i}`,
      `action number ${i}`,
    ]);
    const lines = renderKeyHints(many, 40);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(visibleWidth(l)).toBeLessThanOrEqual(40);
  });
});
