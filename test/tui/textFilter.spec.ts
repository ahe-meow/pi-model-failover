import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderFilterDraft, rowMatches, TextFilter } from "../../src/tui/primitives/textFilter.js";

describe("TextFilter", () => {
  it("appends Kitty CSI-u printable input and legacy characters", () => {
    const filter = new TextFilter();
    filter.open();

    filter.handleInput("\u001b[113;1u");
    filter.handleInput("\u001b[49;1u");
    filter.handleInput("\u001b[33;1u");
    filter.handleInput("x");
    filter.handleInput(Key.enter);

    expect(filter.query).toBe("q1!x");
  });

  it("pads or truncates drafts to the caller body height", () => {
    const filter = new TextFilter();
    filter.open();

    expect(renderFilterDraft(40, "Filter", filter, 7)).toHaveLength(7);
    expect(renderFilterDraft(40, "Filter", filter, 2)).toHaveLength(2);
  });

  it("matches visible row text without ANSI sequence numbers", () => {
    const row = { text: "\u001b[92mok\u001b[39m" };

    expect(rowMatches(row, "92")).toBe(false);
    expect(rowMatches(row, "ok")).toBe(true);
  });
});
