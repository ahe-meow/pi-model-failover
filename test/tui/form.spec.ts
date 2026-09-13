import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { Form } from "../../src/tui/primitives/form.js";

describe("Form", () => {
  it("Tab moves focus, number clamps, secret redacts", () => {
    const f = new Form(
      [
        { kind: "text", key: "k", label: "Key", value: "demo-1234567890abcd", secret: true },
        { kind: "number", key: "n", label: "N", value: 7, min: 5, max: 20 },
        { kind: "text", key: "tail", label: "Tail", value: "" },
      ],
      vi.fn(),
      vi.fn(),
    );
    expect(f.render(60)[0]).toContain("dem…abcd");
    f.handleInput(Key.tab);
    f.handleInput(Key.enter);
    f.handleInput("9");
    expect(f.render(60).join("\n")).toContain("20");
  });

  it("opens a text field editor on Enter and supports save or cancel", () => {
    const f = new Form(
      [
        { kind: "text", key: "name", label: "Name", value: "old" },
        { kind: "number", key: "count", label: "Count", value: 1 },
      ],
      vi.fn(),
      vi.fn(),
    );

    f.handleInput(Key.enter);
    expect(f.render(60).join("\n")).toContain("Input");
    f.handleInput("new");
    expect(f.values().name).toBe("old");
    f.handleInput(Key.escape);
    expect(f.values().name).toBe("old");

    f.handleInput(Key.enter);
    f.handleInput("x");
    f.handleInput(Key.enter);
    expect(f.values().name).toBe("oldx");
  });

  it("renders complete select options with bracket markers", () => {
    const f = new Form(
      [
        { kind: "select", key: "mode", label: "Mode", value: "one", options: ["one", "two"] },
        { kind: "number", key: "count", label: "Count", value: 1 },
      ],
      vi.fn(),
      vi.fn(),
    );

    const form = f.render(80).join("\n");
    expect(form).toContain("[x] one");
    expect(form).toContain("[ ] two");
    expect(form).not.toContain("◂");
    expect(form).not.toContain("▸");

    f.handleInput(Key.enter);
    f.handleInput(Key.down);
    f.handleInput(Key.enter);
    expect(f.values().mode).toBe("two");
  });

  it("Enter on last field submits values; Esc cancels", () => {
    const submit = vi.fn();
    const cancel = vi.fn();
    const f = new Form([{ kind: "number", key: "n", label: "N", value: 3 }], submit, cancel);
    f.handleInput(Key.enter);
    expect(submit).toHaveBeenCalledWith({ n: 3 });
    f.handleInput(Key.escape);
    expect(cancel).toHaveBeenCalled();
  });
});
