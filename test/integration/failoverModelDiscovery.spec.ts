import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nodeFs } from "../../src/adapters/nodeFs.js";

const model = {
  id: "coding",
  name: "Coding",
  api: "pi-model-failover",
  baseUrl: "https://failover.invalid",
  reasoning: false,
  input: ["text"],
  contextWindow: 4096,
  maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

describe("independent Pi model runtime discovery", () => {
  it("discovers the persisted virtual model catalog in a separate Node process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmf-discovery-"));
    const modelsPath = join(dir, "models.json");
    const authPath = join(dir, "auth.json");
    const fixture = fileURLToPath(
      new URL("../fixtures/model-discovery-child.mjs", import.meta.url),
    );
    const models = {
      providers: {
        failover: {
          name: "Failover",
          api: "pi-model-failover",
          models: [model],
          piModelFailoverVirtual: true,
        },
      },
    };
    await nodeFs.writeAtomic(modelsPath, JSON.stringify(models), 0o600);
    await nodeFs.writeAtomic(authPath, "{}", 0o600);

    const output = execFileSync(process.execPath, [fixture, modelsPath, authPath], {
      encoding: "utf8",
      timeout: 15000,
    });

    expect(JSON.parse(output)).toEqual({
      provider: "failover",
      id: "coding",
      api: "pi-model-failover",
      baseUrl: "https://failover.invalid",
      registeredExtension: false,
    });
  });
});
