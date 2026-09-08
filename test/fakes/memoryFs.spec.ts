import { describe, expect, it } from "vitest";
import { MemoryFs } from "./memoryFs.js";

describe("MemoryFs", () => {
  it("writeAtomic stores text and records mode", async () => {
    const fs = new MemoryFs();
    await fs.writeAtomic("/d/a.json", "{}", 0o600);
    expect(await fs.readText("/d/a.json")).toBe("{}");
    expect(fs.modes.get("/d/a.json")).toBe(0o600);
  });
  it("readText returns null for missing files", async () => {
    expect(await new MemoryFs().readText("/nope")).toBeNull();
  });
  it("tryCreateExclusive is true once", async () => {
    const fs = new MemoryFs();
    expect(await fs.tryCreateExclusive("/lock")).toBe(true);
    expect(await fs.tryCreateExclusive("/lock")).toBe(false);
    await fs.unlink("/lock");
    expect(await fs.tryCreateExclusive("/lock")).toBe(true);
  });
});
