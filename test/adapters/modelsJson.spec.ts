import { chmodSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../../src/adapters/modelsJson.js";
import { nodeFs } from "../../src/adapters/nodeFs.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { renameProvider, upsertProvider } from "../../src/domain/providers.js";
import type { ModelsJson, ProviderNode } from "../../src/domain/types.js";
import { S } from "../../src/strings.js";
import { MemoryFs } from "../fakes/memoryFs.js";

const path = "/agent/models.json";
const fixtureUrl = new URL("../fixtures/models.pmm-and-unknown.json", import.meta.url);
const readFixtureText = () => readFileSync(fixtureUrl, "utf8");
const parseModels = (text: string): ModelsJson => JSON.parse(text) as ModelsJson;

const provider = (id: string): ProviderNode => ({
  name: id,
  baseUrl: `https://${id}.example/v1`,
  api: "openai-completions",
  models: [],
});

const validModel: Record<string, unknown> = {
  id: "m",
  reasoning: false,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
};

const validProvider: Record<string, unknown> = {
  name: "Relay",
  baseUrl: "https://relay.example/v1",
  api: "openai-completions",
  models: [validModel],
};

const without = (value: Record<string, unknown>, key: string): Record<string, unknown> => {
  const copy = { ...value };
  delete copy[key];
  return copy;
};

describe("ModelsJsonFile", () => {
  it("C6: renames one provider without dropping unknown fields", async () => {
    const fs = new MemoryFs();
    const originalText = readFixtureText();
    fs.files.set(path, originalText);
    const queue = new WriteQueue();
    const write = vi.spyOn(fs, "writeAtomic");
    const file = new ModelsJsonFile(fs, queue, path);

    const next = await file.update((models) => renameProvider(models, "relay", "Renamed"));

    const expected = parseModels(originalText);
    const relay = expected.providers.relay;
    if (!relay) throw new Error("fixture missing relay provider");
    relay.name = "Renamed";
    expect(write).toHaveBeenCalledTimes(1);
    expect(parseModels(fs.files.get(path) ?? "")).toEqual(expected);
    expect(next).toEqual(expected);
    expect(next.providers.relay?.unknownProvider).toEqual({ deep: { keep: "yes" } });
    expect(next.providers.relay?.models[0]?.unknownModel).toEqual({ keep: [true, false] });
    expect(next.unknownRoot).toEqual({ keep: true, nested: [1, { x: "y" }] });
  });

  it("C1: applies two queued updates to fresh successive snapshots", async () => {
    const fs = new MemoryFs();
    const write = vi.spyOn(fs, "writeAtomic");
    const file = new ModelsJsonFile(fs, new WriteQueue(), path);

    await Promise.all([
      file.update((models) => upsertProvider(models, "a", provider("a"))),
      file.update((models) => upsertProvider(models, "b", provider("b"))),
    ]);

    expect(Object.keys((await file.read()).providers)).toEqual(["a", "b"]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("accepts Pi provider and model fields that are optional", async () => {
    const fs = new MemoryFs();
    const value = {
      providers: {
        failover: {
          name: "Failover",
          models: [
            {
              id: "chain-a",
              api: "openai-completions",
              baseUrl: "https://relay.example/v1",
            },
          ],
        },
        relay: {
          baseUrl: "https://relay.example/v1",
          api: "openai-completions",
          authHeader: true,
          models: [{ id: "m" }],
        },
      },
      unknownRoot: { keep: true },
    };
    fs.files.set(path, JSON.stringify(value));

    const result = await new ModelsJsonFile(fs, new WriteQueue(), path).read();

    expect(result.providers.failover?.api).toBeUndefined();
    expect(result.providers.failover?.baseUrl).toBeUndefined();
    expect(result.providers.failover?.models[0]).toMatchObject({
      id: "chain-a",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    expect(result.providers.relay?.name).toBe("relay");
    expect(result.providers.relay?.authHeader).toBe(true);
    expect(result.unknownRoot).toEqual({ keep: true });
  });

  it("keeps extension writes strict after permissive reads", async () => {
    const fs = new MemoryFs();
    fs.files.set(
      path,
      JSON.stringify({
        providers: {
          relay: {
            name: "Relay",
            baseUrl: "https://relay.example/v1",
            api: "openai-completions",
            models: [{ id: "m" }],
          },
        },
      }),
    );
    const write = vi.spyOn(fs, "writeAtomic");
    const file = new ModelsJsonFile(fs, new WriteQueue(), path);

    await expect(
      file.update((models) => {
        const model = models.providers.relay?.models[0];
        if (model === undefined) throw new Error("missing model");
        Reflect.deleteProperty(model, "cost");
        return models;
      }),
    ).rejects.toThrow(S.modelsJsonInvalid);
    expect(write).not.toHaveBeenCalled();
  });

  it("treats only a missing file as an empty models object", async () => {
    await expect(
      new ModelsJsonFile(new MemoryFs(), new WriteQueue(), path).read(),
    ).resolves.toEqual({
      providers: {},
    });
  });

  it("rejects malformed and invalid top-level data without writing or exposing source text", async () => {
    const invalid = [
      '{"providers":{"relay":{"apiKey":"invalid-credential"}',
      "null",
      "[]",
      "{}",
      JSON.stringify({ providers: [] }),
      JSON.stringify({ providers: null }),
    ];

    for (const text of invalid) {
      const fs = new MemoryFs();
      fs.files.set(path, text);
      const write = vi.spyOn(fs, "writeAtomic");
      const file = new ModelsJsonFile(fs, new WriteQueue(), path);

      await expect(file.read()).rejects.toThrow(S.modelsJsonInvalid);
      await expect(file.read()).rejects.not.toThrow(text);
      await expect(file.update((models) => models)).rejects.toThrow(S.modelsJsonInvalid);
      expect(write).not.toHaveBeenCalled();
      expect(fs.files.get(path)).toBe(text);
    }
  });

  it("rejects malformed providers, models, and ownership markers before any write", async () => {
    const invalid: Array<[string, Record<string, unknown>]> = [
      ["null provider", { relay: null }],
      ["array provider", { relay: [] }],
      ["invalid provider api", { relay: { ...validProvider, api: "unknown-api" } }],
      ["non-array provider models", { relay: { ...validProvider, models: {} } }],
      ["null model", { relay: { ...validProvider, models: [null] } }],
      ["missing model id", { relay: { ...validProvider, models: [without(validModel, "id")] } }],
      [
        "invalid model input",
        { relay: { ...validProvider, models: [{ ...validModel, input: ["audio"] }] } },
      ],
      [
        "invalid model cost",
        { relay: { ...validProvider, models: [{ ...validModel, cost: null }] } },
      ],
      [
        "invalid failover marker",
        { relay: { ...validProvider, piModelFailover: { group: "kg-1" } } },
      ],
      [
        "invalid failover group",
        {
          relay: {
            ...validProvider,
            piModelFailover: { group: 42, costMultiplier: 0.1 },
          },
        },
      ],
      [
        "invalid manager marker",
        { relay: { ...validProvider, piModelManager: { managed: "yes" } } },
      ],
    ];

    for (const [label, providers] of invalid) {
      const original = JSON.stringify({ providers });
      const fs = new MemoryFs();
      fs.files.set(path, original);
      const write = vi.spyOn(fs, "writeAtomic");
      const file = new ModelsJsonFile(fs, new WriteQueue(), path);

      await expect(file.read(), label).rejects.toThrow(S.modelsJsonInvalid);
      await expect(
        file.update((models) => models),
        label,
      ).rejects.toThrow(S.modelsJsonInvalid);
      expect(write, label).not.toHaveBeenCalled();
      expect(fs.files.get(path), label).toBe(original);
    }
  });

  it("rejects an invalid callback candidate before writing", async () => {
    const fs = new MemoryFs();
    const original = readFixtureText();
    fs.files.set(path, original);
    const write = vi.spyOn(fs, "writeAtomic");
    const file = new ModelsJsonFile(fs, new WriteQueue(), path);

    await expect(file.update(() => ({ providers: [] }) as unknown as ModelsJson)).rejects.toThrow(
      S.modelsJsonInvalid,
    );

    expect(write).not.toHaveBeenCalled();
    expect(fs.files.get(path)).toBe(original);
  });

  it("leaves original bytes unchanged when the callback fails", async () => {
    const fs = new MemoryFs();
    const original = readFixtureText();
    fs.files.set(path, original);
    const write = vi.spyOn(fs, "writeAtomic");
    const file = new ModelsJsonFile(fs, new WriteQueue(), path);

    await expect(
      file.update(() => {
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");

    expect(write).not.toHaveBeenCalled();
    expect(fs.files.get(path)).toBe(original);
  });

  it("leaves original bytes unchanged when writeAtomic rejects", async () => {
    const fs = new MemoryFs();
    const original = readFixtureText();
    fs.files.set(path, original);
    const write = vi.spyOn(fs, "writeAtomic").mockRejectedValueOnce(new Error("disk full"));
    const file = new ModelsJsonFile(fs, new WriteQueue(), path);

    await expect(
      file.update((models) => renameProvider(models, "relay", "Renamed")),
    ).rejects.toThrow("disk full");

    expect(write).toHaveBeenCalledTimes(1);
    expect(fs.files.get(path)).toBe(original);
  });

  it("rejects serialization failures before writing", async () => {
    const fs = new MemoryFs();
    const original = readFixtureText();
    fs.files.set(path, original);
    const write = vi.spyOn(fs, "writeAtomic");
    const file = new ModelsJsonFile(fs, new WriteQueue(), path);

    await expect(
      file.update((models) => {
        models.cycle = models;
        return models;
      }),
    ).rejects.toThrow();

    expect(write).not.toHaveBeenCalled();
    expect(fs.files.get(path)).toBe(original);
  });

  it("enqueues each update once and performs one atomic write per update", async () => {
    const fs = new MemoryFs();
    const queue = new WriteQueue();
    const enqueue = vi.spyOn(queue, "enqueue");
    const write = vi.spyOn(fs, "writeAtomic");
    const file = new ModelsJsonFile(fs, queue, path);

    await file.update((models) => upsertProvider(models, "a", provider("a")));
    await file.update((models) => upsertProvider(models, "b", provider("b")));

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("C21: preserves an existing non-default mode through a real Node round trip", async () => {
    if (process.platform === "android") return;

    const dir = mkdtempSync(join(tmpdir(), "pmf-models-"));
    const filePath = join(dir, "models.json");
    await nodeFs.writeAtomic(filePath, readFixtureText(), 0o600);
    chmodSync(filePath, 0o660);

    const file = new ModelsJsonFile(nodeFs, new WriteQueue(), filePath);
    await file.update((models) => renameProvider(models, "relay", "Renamed"));

    expect(statSync(filePath).mode & 0o777).toBe(0o660);
    const result = parseModels((await nodeFs.readText(filePath)) ?? "");
    expect(result.providers.relay?.name).toBe("Renamed");
  });
});
