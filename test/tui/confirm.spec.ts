import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { Confirm } from "../../src/tui/primitives/confirm.js";

describe("Confirm", () => {
  it("defaults to Cancel; Left then Enter confirms", () => {
    const ok = vi.fn();
    const no = vi.fn();
    const c = new Confirm("Delete?", ["detail"], ok, no);
    c.handleInput(Key.enter);
    expect(no).toHaveBeenCalledTimes(1);
    c.handleInput(Key.left);
    c.handleInput(Key.enter);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
