import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

interface PackageManifest {
  pi?: {
    extensions?: string[];
  };
}

it("declares the extension entry in the Pi package manifest", () => {
  const packageManifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageManifest;

  expect(packageManifest.pi?.extensions ?? []).toContain("./src/index.ts");
});
