import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("strings live in src/strings.ts", () => {
  it("no multi-word literal longer than 12 chars in src/tui", () => {
    const offenders: string[] = [];
    for (const f of walk("src/tui")) {
      for (const m of readFileSync(f, "utf8").matchAll(/"([^"\n]{13,})"/g)) {
        const literal = m[1];
        if (literal !== undefined && /\s/.test(literal)) offenders.push(`${f}: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
