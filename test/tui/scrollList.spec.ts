import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { ScrollList } from "../../src/tui/primitives/scrollList.js";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `row${i}` }));

describe("ScrollList (C19)", () => {
  it("renders exactly listRows lines and pads short lists", () => {
    const list = new ScrollList({ listRows: 3 });
    list.setRows(rows(1));

    expect(list.render(10)[0]).toBe("\x1b[7mrow0      \x1b[27m");
    expect(list.render(10)[0]).not.toContain("▶");
  });

  it("keeps table headers aligned with overflow rows", () => {
    const list = new ScrollList({
      listRows: 1,
      columns: [{ header: "Provider" }, { header: "API" }],
    });
    list.setRows([
      { text: "", cells: ["long-provider-name", "openai"] },
      { text: "", cells: ["another", "anthropic"] },
    ]);

    const header = stripTerminalSequences(list.header(24));
    const row = stripTerminalSequences(list.render(24)[0] ?? "");
    expect(header.indexOf("API")).toBe(row.indexOf("openai"));
  });

  it("does not render a scrollbar when rows fit", () => {
    const list = new ScrollList({ listRows: 7 });
    list.setRows(rows(7));

    expect(list.render(20)).toHaveLength(7);
    for (const line of list.render(20)) expect(line).not.toMatch(/[█░]/);
  });

  it("renders an overflow scrollbar with the thumb at the top", () => {
    const list = new ScrollList({ listRows: 7 });
    list.setRows(rows(21));

    const output = list.render(20);
    expect(output[0]?.slice(-2)).toBe(" █");
    expect(output[6]?.slice(-2)).toBe(" ░");
    expect(output.filter((line) => line.endsWith("█"))).toHaveLength(2);
  });

  it("keeps the selected row visible and moves the scrollbar thumb to the bottom", () => {
    const list = new ScrollList({ listRows: 7 });
    list.setRows(rows(21));
    list.end();

    const output = list.render(20);
    expect(output[6]).toContain("\x1b[7mrow20");
    expect(output[6]?.slice(-2)).toBe(" █");
    expect(output.filter((line) => line.endsWith("█"))).toHaveLength(2);
  });

  it("pages by listRows while keeping the new selection visible", () => {
    const list = new ScrollList({ listRows: 3 });
    list.setRows(rows(10));

    list.pageDown();
    expect(list.selected).toBe(3);
    expect(list.render(20).some((line) => line.includes("\x1b[7mrow3"))).toBe(true);

    list.pageUp();
    expect(list.selected).toBe(0);
    expect(list.render(20)[0]).toContain("\x1b[7mrow0");
  });

  it("truncates a row to the requested width", () => {
    const list = new ScrollList({ listRows: 1 });
    list.setRows([{ text: "abcdefghijklmnop" }]);

    const line = list.render(10)[0] ?? "";
    expect(visibleWidth(line)).toBe(10);
    expect(line).toContain("\x1b[7mabcde");
    expect(line).toContain("...");
  });

  it("toggles marks only when multiSelect is enabled", () => {
    const single = new ScrollList({ listRows: 5 });
    single.setRows(rows(2));
    single.toggleMark();
    expect(single.markedIndices()).toEqual([]);

    const multi = new ScrollList({ listRows: 5, multiSelect: true });
    multi.setRows(rows(2));
    multi.toggleMark();
    expect(multi.markedIndices()).toEqual([0]);
    expect(multi.render(20)[0]).toContain("\x1b[7m[x] row0");
  });
});
