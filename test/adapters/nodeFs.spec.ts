import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeFs, systemClock } from "../../src/adapters/nodeFs.js";

describe("nodeFs", () => {
  it("writeAtomic writes via tmp+rename with the requested mode (C21)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmf-"));
    const path = join(dir, "a.json");

    await nodeFs.writeAtomic(path, "{}", 0o600);

    expect(readFileSync(path, "utf8")).toBe("{}");
    if (process.platform !== "android") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(await nodeFs.readText(join(dir, "missing"))).toBeNull();
    expect(await nodeFs.tryCreateExclusive(join(dir, "lock"))).toBe(true);
    expect(await nodeFs.tryCreateExclusive(join(dir, "lock"))).toBe(false);
    expect(systemClock.now()).toBeTypeOf("number");
  });
});
