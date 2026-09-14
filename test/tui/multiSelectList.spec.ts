import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { MultiSelectList } from "../../src/tui/primitives/multiSelectList.js";

describe("MultiSelectList", () => {
  it("C2: marks all, clears all, and confirms marked indices", () => {
    const confirmed: number[][] = [];
    const list = new MultiSelectList({
      listRows: 2,
      onConfirm: (indices) => confirmed.push(indices),
    });
    list.setRows([{ text: "a" }, { text: "b" }, { text: "c" }]);
    list.handleInput("a");
    expect(list.markedIndices()).toEqual([0, 1, 2]);
    list.handleInput("n");
    expect(list.markedIndices()).toEqual([]);
    list.handleInput("a");
    list.handleInput(Key.down);
    list.handleInput(Key.space);
    list.handleInput(Key.enter);
    expect(confirmed).toEqual([[0, 2]]);
  });

  it("applies select-all and select-none only to visible filtered rows", () => {
    const confirmed: number[][] = [];
    const rows = [
      { text: "hidden-unmarked" },
      { text: "visible-a" },
      { text: "hidden-marked", marked: true },
      { text: "visible-b" },
    ];
    const list = new MultiSelectList({
      listRows: 2,
      onConfirm: (indices) => confirmed.push(indices),
    });
    list.setRows(rows);
    list.setVisibleIndices([1, 3]);

    list.handleInput("a");
    expect(list.markedIndices()).toEqual([1, 2, 3]);
    list.handleInput(Key.enter);

    list.handleInput("n");
    expect(list.markedIndices()).toEqual([2]);
    list.handleInput(Key.enter);

    expect(confirmed).toEqual([[1, 2, 3], [2]]);
  });

  it("C2: accepts Kitty sequences for select all and none", () => {
    const list = new MultiSelectList({ listRows: 2, onConfirm: () => {} });
    list.setRows([{ text: "a" }, { text: "b" }]);

    list.handleInput("\u001b[97;1u");
    expect(list.markedIndices()).toEqual([0, 1]);

    list.handleInput("\u001b[110;1u");
    expect(list.markedIndices()).toEqual([]);
  });

  it.each([
    { name: "up", before: [Key.down, Key.down], key: Key.up, expected: 1 },
    { name: "down", before: [], key: Key.down, expected: 1 },
    { name: "pageUp", before: [Key.pageDown], key: Key.pageUp, expected: 0 },
    { name: "pageDown", before: [], key: Key.pageDown, expected: 2 },
    { name: "home", before: [Key.end], key: Key.home, expected: 0 },
    { name: "end", before: [], key: Key.end, expected: 5 },
  ])("C19: dispatches $name movement through the wrapper", ({ before, key, expected }) => {
    const list = new MultiSelectList({ listRows: 2, onConfirm: () => {} });
    list.setRows(Array.from({ length: 6 }, (_, index) => ({ text: `row${index}` })));

    for (const input of before) list.handleInput(input);
    list.handleInput(key);
    list.handleInput(Key.space);

    expect(list.markedIndices()).toEqual([expected]);
  });

  it("C19: updates fixed height through setListRows", () => {
    const list = new MultiSelectList({ listRows: 2, onConfirm: () => {} });
    list.setRows([{ text: "a" }, { text: "b" }, { text: "c" }]);

    expect(list.render(20)).toHaveLength(2);
    list.setListRows(4);
    expect(list.render(20)).toHaveLength(4);
    expect(list.render(20).some((line) => /[█░]/.test(line))).toBe(false);
  });

  it("preserves caller-owned row references", () => {
    const rows: Array<{ text: string; marked?: boolean }> = [{ text: "a" }, { text: "b" }];
    const list = new MultiSelectList({ listRows: 2, onConfirm: () => {} });
    list.setRows(rows);

    list.handleInput(Key.space);

    expect(rows[0]?.marked).toBe(true);
  });

  it("uses replacement rows after movement", () => {
    const oldRows = Array.from({ length: 5 }, (_, index) => ({ text: `old${index}` }));
    const newRows: Array<{ text: string; marked?: boolean }> = [{ text: "new0" }, { text: "new1" }];
    const confirmed: number[][] = [];
    const list = new MultiSelectList({
      listRows: 2,
      onConfirm: (indices) => confirmed.push(indices),
    });
    list.setRows(oldRows);
    list.handleInput(Key.end);
    list.setRows(newRows);

    list.handleInput(Key.space);
    list.handleInput(Key.enter);

    expect(newRows[1]?.marked).toBe(true);
    expect(confirmed).toEqual([[1]]);
  });

  it("C19: preserves fixed rows and scrollbar behavior", () => {
    const list = new MultiSelectList({ listRows: 2, onConfirm: () => {} });
    list.setRows([{ text: "a" }, { text: "b" }, { text: "c" }]);
    expect(list.render(20)).toHaveLength(2);
    expect(list.render(20).some((line) => /[█░]/.test(line))).toBe(true);
  });
});
