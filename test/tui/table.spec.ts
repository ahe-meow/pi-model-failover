import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { createTable } from "../../src/tui/primitives/table.js";

describe("createTable", () => {
  it("uses one width calculation for headers and rows", () => {
    const table = createTable(
      [{ header: "ID" }, { header: "API" }, { header: "Models" }],
      [
        ["short", "openai", "2"],
        ["long-provider", "anthropic", "12"],
      ],
      40,
    );

    expect(table.header.indexOf("API")).toBe(table.row(["short", "openai", "2"]).indexOf("openai"));
    expect(table.header.indexOf("Models")).toBe(
      table.row(["long-provider", "anthropic", "12"]).indexOf("12"),
    );
  });

  it("truncates the same layout to a narrow terminal", () => {
    const table = createTable(
      [{ header: "Provider" }, { header: "API" }, { header: "Owner" }],
      [["very-long-provider", "openai-completions", "failover"]],
      12,
    );

    expect(visibleWidth(table.header)).toBeLessThanOrEqual(12);
    expect(
      visibleWidth(table.row(["very-long-provider", "openai-completions", "failover"])),
    ).toBeLessThanOrEqual(12);
  });
});
