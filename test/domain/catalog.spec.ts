import { describe, expect, it } from "vitest";
import {
  CATALOG_DEFAULTS,
  isDrifted,
  removeCatalogModel,
  syncAttributes,
  toModelNode,
  upsertCatalogModel,
} from "../../src/domain/catalog.js";
import type { CatalogModel, ModelNode } from "../../src/domain/types.js";

const catalogModel: CatalogModel = {
  id: "gpt-4.1",
  name: "GPT-4.1",
  reasoning: false,
  vision: true,
  contextWindow: 1047576,
  maxTokens: 32768,
  defaults: { temperature: 0.2, nested: { keep: true } },
};

const providerModel: ModelNode = {
  id: "gpt-4.1",
  name: "relay copy",
  reasoning: true,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
  headers: { "X-Model": "keep" },
  compat: { nested: { keep: true } },
  unknownNode: { untouched: [1, 2, 3] },
};

const otherCatalogModel: CatalogModel = {
  id: "claude-3.7",
  name: "Claude 3.7",
  reasoning: true,
  vision: false,
  contextWindow: 200000,
  maxTokens: 64000,
  defaults: { temperature: 0.7 },
};

describe("catalog defaults and immutable catalog operations", () => {
  it("C4: exposes complete defaults without an optional name", () => {
    expect(CATALOG_DEFAULTS).toEqual({
      reasoning: true,
      vision: true,
      contextWindow: 272000,
      maxTokens: 128000,
      defaults: {},
    });
    expect(Object.hasOwn(CATALOG_DEFAULTS, "name")).toBe(false);
  });

  it("C5: replaces a catalog model by id without mutating or sharing the replacement", () => {
    const catalog = [catalogModel, otherCatalogModel];
    const replacement: CatalogModel = {
      ...catalogModel,
      name: "GPT-4.1 revised",
      defaults: { temperature: 0.4, nested: { keep: false } },
    };
    const originalCatalog = structuredClone(catalog);

    const next = upsertCatalogModel(catalog, replacement);

    expect(next).toEqual([replacement, otherCatalogModel]);
    expect(next).not.toBe(catalog);
    expect(next[0]).not.toBe(replacement);
    expect(next[0]?.defaults).not.toBe(replacement.defaults);
    expect(catalog).toEqual(originalCatalog);
  });

  it("C5: appends a new catalog id with a copied array and model", () => {
    const catalog = [catalogModel];
    const added: CatalogModel = { ...otherCatalogModel, defaults: { nested: { keep: true } } };

    const next = upsertCatalogModel(catalog, added);

    expect(next).toEqual([catalogModel, added]);
    expect(next).not.toBe(catalog);
    expect(next[1]).not.toBe(added);
    expect(next[1]?.defaults).not.toBe(added.defaults);
  });

  it("C5: removes only the requested catalog id without mutating the input array", () => {
    const catalog = [catalogModel, otherCatalogModel];

    const next = removeCatalogModel(catalog, catalogModel.id);

    expect(next).toEqual([otherCatalogModel]);
    expect(next).not.toBe(catalog);
    expect(catalog).toEqual([catalogModel, otherCatalogModel]);
  });
});

describe("catalog model nodes", () => {
  it("C4: copies a catalog model with independent defaults and zero cost", () => {
    const copy = toModelNode(catalogModel);

    expect(copy).toEqual({
      id: "gpt-4.1",
      name: "GPT-4.1",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 1047576,
      maxTokens: 32768,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      defaults: { temperature: 0.2, nested: { keep: true } },
    });
    expect(copy.defaults).not.toBe(catalogModel.defaults);
    expect((copy.defaults as { nested: { keep: boolean } }).nested).not.toBe(
      catalogModel.defaults.nested,
    );
    (copy.defaults as { nested: { keep: boolean } }).nested.keep = false;
    expect(catalogModel.defaults).toEqual({ temperature: 0.2, nested: { keep: true } });
    expect(isDrifted(copy, catalogModel)).toBe(false);
    expect(copy).not.toBe(catalogModel);
  });

  it("C4: maps a catalog model without vision to text-only input and omits name", () => {
    const withoutName: CatalogModel = { ...otherCatalogModel };
    delete withoutName.name;

    const copy = toModelNode(withoutName);

    expect(copy.input).toEqual(["text"]);
    expect(Object.hasOwn(copy, "name")).toBe(false);
  });
});

describe("catalog attribute synchronization", () => {
  it("C5: syncs four attributes and preserves owned fields", () => {
    const original = structuredClone(providerModel);
    const next = syncAttributes(providerModel, catalogModel);

    expect(next).toEqual({
      ...providerModel,
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 1047576,
      maxTokens: 32768,
    });
    expect(next.cost).toEqual(providerModel.cost);
    expect(next.headers).toEqual(providerModel.headers);
    expect(next.compat).toEqual(providerModel.compat);
    expect(next.unknownNode).toEqual(providerModel.unknownNode);
    expect(next).not.toBe(providerModel);
    expect(providerModel).toEqual(original);
  });

  it.each([
    ["reasoning", { reasoning: true }],
    ["input", { input: ["text"] }],
    ["contextWindow", { contextWindow: 1 }],
    ["maxTokens", { maxTokens: 1 }],
  ] as const)("C5: detects drift when %s differs", (_field, change) => {
    const copy = toModelNode(catalogModel);
    const drifted = { ...copy, ...change } as ModelNode;

    expect(isDrifted(drifted, catalogModel)).toBe(true);
  });
});
