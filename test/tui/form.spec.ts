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
    f.handleInput(Key.enter);
    expect(f.values().n).toBe(20);
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

  it("enters the editor before submitting the last field", () => {
    const submit = vi.fn();
    const f = new Form([{ kind: "text", key: "name", label: "Name", value: "" }], submit, vi.fn());

    f.handleInput(Key.enter);

    expect(f.isEditing()).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(f.render(40).join("\n")).toContain("Input Name");
  });

  it("inserts number input at the cursor", () => {
    const f = new Form(
      [{ kind: "number", key: "n", label: "N", value: 20, min: 0, max: 999 }],
      vi.fn(),
      vi.fn(),
    );

    f.handleInput(Key.enter);
    f.handleInput(Key.home);
    f.handleInput("1");
    f.handleInput(Key.enter);

    expect(f.values().n).toBe(120);
  });

  it("shows the cursor while editing text", () => {
    const f = new Form(
      [{ kind: "text", key: "name", label: "Name", value: "old" }],
      vi.fn(),
      vi.fn(),
    );

    f.handleInput(Key.enter);

    expect(f.render(60).join("\n")).toContain("old▌");
  });

  it("keeps the cursor visible for a long value", () => {
    const f = new Form(
      [{ kind: "text", key: "name", label: "Name", value: "abcdefghijklmnopqrstuvwxyz" }],
      vi.fn(),
      vi.fn(),
    );

    f.handleInput(Key.enter);

    expect(f.render(24).join("\n")).toContain("▌");
  });
  it("submits current values with Ctrl+S", () => {
    const submit = vi.fn();
    const f = new Form(
      [
        { kind: "text", key: "name", label: "Name", value: "old" },
        { kind: "number", key: "n", label: "N", value: 3 },
      ],
      submit,
      vi.fn(),
    );

    f.handleInput(Key.down);
    f.handleInput("4");
    f.handleInput(Key.ctrl("s"));

    expect(f.values()).toEqual({ name: "old", n: 34 });
    expect(submit).toHaveBeenCalledWith({ name: "old", n: 34 });
  });

  it("does not submit when Enter commits direct input on the final field", () => {
    const submit = vi.fn();
    const cancel = vi.fn();
    const f = new Form([{ kind: "number", key: "n", label: "N", value: 3 }], submit, cancel);

    f.handleInput("4");
    f.handleInput(Key.enter);

    expect(f.values().n).toBe(34);
    expect(submit).not.toHaveBeenCalled();
    f.handleInput(Key.escape);
    expect(cancel).toHaveBeenCalled();
  });

  it("commits an active final-field draft without submitting", () => {
    const submit = vi.fn();
    const f = new Form([{ kind: "number", key: "n", label: "N", value: 3 }], submit, vi.fn());

    f.handleInput(Key.enter);
    f.handleInput("4");
    f.handleInput(Key.enter);

    expect(f.values().n).toBe(34);
    expect(submit).not.toHaveBeenCalled();
  });

  it("commits an active draft before Ctrl+S submits", () => {
    const submit = vi.fn();
    const f = new Form([{ kind: "number", key: "n", label: "N", value: 3 }], submit, vi.fn());

    f.handleInput(Key.enter);
    f.handleInput("4");
    f.handleInput(Key.ctrl("s"));

    expect(f.values().n).toBe(34);
    expect(submit).toHaveBeenCalledWith({ n: 34 });
  });

  it("inserts a newline in a multiline field before Ctrl+S submits", () => {
    const submit = vi.fn();
    const f = new Form(
      [{ kind: "text", key: "headers", label: "Headers", value: "first", multiline: true }],
      submit,
      vi.fn(),
    );

    f.handleInput("\n");
    f.handleInput("second");
    expect(f.values().headers).toBe("first\nsecond");
    expect(submit).not.toHaveBeenCalled();

    f.handleInput(Key.ctrl("s"));

    expect(submit).toHaveBeenCalledWith({ headers: "first\nsecond" });
  });

  it("cancels the whole form when a direct edit is left with Esc", () => {
    const cancel = vi.fn();
    const f = new Form(
      [{ kind: "text", key: "multiplier", label: "Multiplier", value: "0.1" }],
      vi.fn(),
      cancel,
      { exitOnEscape: true },
    );

    f.handleInput(Key.enter);
    expect(f.isEditing()).toBe(true);
    f.handleInput("9");
    f.handleInput(Key.escape);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(f.isEditing()).toBe(false);
    expect(f.values().multiplier).toBe("0.1");
  });

  it("keeps the form open when Esc leaves an editor without exitOnEscape", () => {
    const cancel = vi.fn();
    const f = new Form(
      [{ kind: "text", key: "name", label: "Name", value: "old" }],
      vi.fn(),
      cancel,
    );

    f.handleInput(Key.enter);
    f.handleInput(Key.escape);

    expect(cancel).not.toHaveBeenCalled();
    expect(f.isEditing()).toBe(false);
  });
});
