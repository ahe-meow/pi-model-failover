import { describe, expect, it } from "vitest";
import {
  addModelToProviders,
  deleteProvider,
  listProviders,
  providersWithModel,
  removeModel,
  renameProvider,
  renameProviderId,
  setMultiplier,
  upsertProvider,
} from "../../src/domain/providers.js";
import type { ModelNode, ModelsJson, ProviderNode } from "../../src/domain/types.js";

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
};

const model = (id: string): ModelNode => ({
  id,
  reasoning: false,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
  unknownModel: { nested: ["keep"] },
});

const emptyProvider = (id: string): ProviderNode => ({
  name: id,
  baseUrl: "u",
  api: "openai-completions",
  models: [],
});

const source = deepFreeze<ModelsJson>({
  unknownRoot: { keep: true },
  providers: {
    b: {
      name: "B",
      baseUrl: "u",
      api: "openai-completions",
      models: [model("m")],
      unknownProvider: { nested: ["keep"] },
      piModelFailover: { group: "g", costMultiplier: 1 },
    },
    a: {
      name: "A",
      baseUrl: "u",
      api: "openai-completions",
      models: [model("m")],
      unknownProvider: { nested: ["keep-a"] },
      piModelFailover: { group: "g", costMultiplier: 0.1 },
    },
    c: {
      name: "C",
      baseUrl: "u",
      api: "openai-completions",
      models: [model("m")],
      piModelFailover: { group: "g", costMultiplier: 0.1 },
    },
    pmm: {
      name: "PMM",
      baseUrl: "u",
      api: "openai-completions",
      models: [model("m")],
      piModelManager: { managed: true },
    },
  },
});

describe("provider listing and ordering", () => {
  it("lists failover-owned providers with multipliers and PMM providers as unowned", () => {
    const listed = listProviders(source);

    expect(listed.map(({ id, owned, multiplier }) => ({ id, owned, multiplier }))).toEqual([
      { id: "b", owned: true, multiplier: 1 },
      { id: "a", owned: true, multiplier: 0.1 },
      { id: "c", owned: true, multiplier: 0.1 },
      { id: "pmm", owned: false, multiplier: null },
    ]);
    expect(listed.find(({ id }) => id === "b")?.node.unknownProvider).toEqual({
      nested: ["keep"],
    });
    expect(listed.find(({ id }) => id === "a")?.node.models[0]?.unknownModel).toEqual({
      nested: ["keep"],
    });
  });

  it("C6: returns deep-cloned provider nodes from listProviders", () => {
    const input = structuredClone(source);
    const listedA = listProviders(input).find(({ id }) => id === "a");
    if (!listedA) throw new Error("expected provider a in listing");

    const listedModel = listedA.node.models[0];
    if (!listedModel) throw new Error("expected model m in provider a");
    (listedModel.unknownModel as { nested: string[] }).nested.push("changed");

    expect(input.providers.a?.models[0]?.unknownModel).toEqual({ nested: ["keep"] });
  });

  it("C16: orders equal-multiplier owned providers by id before unowned providers by id", () => {
    const matchingProvider = (id: string, multiplier?: number): ProviderNode => ({
      ...emptyProvider(id),
      models: [model("m")],
      ...(multiplier === undefined
        ? {}
        : { piModelFailover: { group: "g", costMultiplier: multiplier } }),
    });
    const orderingSource: ModelsJson = {
      providers: {
        "owned-z": matchingProvider("owned-z", 0.1),
        "unowned-z": matchingProvider("unowned-z"),
        "owned-a": matchingProvider("owned-a", 0.1),
        "unowned-a": matchingProvider("unowned-a"),
        "owned-b": matchingProvider("owned-b", 0.1),
      },
    };

    expect(providersWithModel(orderingSource, "m")).toEqual([
      "owned-a",
      "owned-b",
      "owned-z",
      "unowned-a",
      "unowned-z",
    ]);
    expect(providersWithModel(orderingSource, "missing")).toEqual([]);
  });
});

describe("immutable provider operations", () => {
  it("upserts a cloned provider without sharing nested unknown fields", () => {
    const replacement: ProviderNode = {
      name: "A replacement",
      baseUrl: "replacement",
      api: "openai-responses",
      models: [model("replacement")],
      piModelFailover: { group: "replacement-group", costMultiplier: 2 },
      unknownProvider: { nested: ["replacement"] },
    };
    const original = structuredClone(source);

    const next = upsertProvider(source, "a", replacement);

    expect(next).not.toBe(source);
    expect(next.providers).not.toBe(source.providers);
    expect(next.providers.a).toEqual(replacement);
    expect(next.providers.a).not.toBe(replacement);
    expect(next.providers.a?.models[0]).not.toBe(replacement.models[0]);
    expect(next.unknownRoot).toEqual({ keep: true });
    expect(source).toEqual(original);
  });

  it("C6: renames one provider while preserving root, provider, model, and marker fields", () => {
    const original = structuredClone(source);

    const next = renameProvider(source, "a", "A renamed");

    expect(next.providers.a?.name).toBe("A renamed");
    expect(next.unknownRoot).toEqual(source.unknownRoot);
    expect(next.providers.a?.piModelFailover).toEqual(source.providers.a?.piModelFailover);
    expect(next.providers.a?.unknownProvider).toEqual({ nested: ["keep-a"] });
    expect(next.providers.a?.models[0]?.unknownModel).toEqual({ nested: ["keep"] });
    expect(next.providers.a).not.toBe(source.providers.a);
    expect(source).toEqual(original);
  });

  it("C7: deletes only one provider and preserves the remaining models.json data", () => {
    const original = structuredClone(source);

    const next = deleteProvider(source, "b");

    expect(next.providers.b).toBeUndefined();
    expect(next.providers.a).toEqual(source.providers.a);
    expect(next.providers.a?.unknownProvider).toEqual({ nested: ["keep-a"] });
    expect(next.providers.a?.models[0]?.unknownModel).toEqual({ nested: ["keep"] });
    expect(next.unknownRoot).toEqual(source.unknownRoot);
    expect(source).toEqual(original);
  });

  it("C4: adds independent model copies to five providers, skips existing models, and ignores missing ids", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    const five = deepFreeze<ModelsJson>({
      unknownRoot: { keep: true },
      providers: Object.fromEntries(ids.map((id) => [id, emptyProvider(id)])),
    });
    const original = structuredClone(five);
    const candidate = model("new");

    const next = addModelToProviders(five, [...ids, "missing"], candidate);
    const copies = ids.map((id) => next.providers[id]?.models[0]);

    expect(copies).toHaveLength(5);
    expect(copies.every((copy) => copy !== undefined)).toBe(true);
    expect(copies.every((copy) => copy !== candidate)).toBe(true);
    expect(copies[0]).toEqual(candidate);
    expect(copies[0]).not.toBe(copies[1]);
    expect(copies[0]?.unknownModel).not.toBe(copies[1]?.unknownModel);
    expect(next.unknownRoot).toEqual({ keep: true });
    expect(five).toEqual(original);

    const skipped = addModelToProviders(source, ["a", "missing"], model("m"));
    expect(skipped.providers.a?.models).toHaveLength(1);
    expect(skipped.providers.missing).toBeUndefined();
  });

  it("removes a model from an existing provider and ignores a missing provider", () => {
    const original = structuredClone(source);

    const next = removeModel(source, "a", "m");
    const missing = removeModel(source, "missing", "m");

    expect(next.providers.a?.models).toEqual([]);
    expect(next.providers.b?.models[0]?.unknownModel).toEqual({ nested: ["keep"] });
    expect(next.unknownRoot).toEqual(source.unknownRoot);
    expect(missing).toEqual(source);
    expect(source).toEqual(original);
  });

  it("updates an existing multiplier while preserving its group and unknown marker fields", () => {
    const withUnknownMarker = deepFreeze<ModelsJson>({
      ...source,
      providers: {
        ...source.providers,
        a: {
          ...source.providers.a,
          piModelFailover: {
            ...source.providers.a?.piModelFailover,
            markerUnknown: { nested: ["keep"] },
          },
        } as ProviderNode,
      },
    });
    const original = structuredClone(withUnknownMarker);

    const next = setMultiplier(withUnknownMarker, "a", 0.25);

    expect(next.providers.a?.piModelFailover).toEqual({
      group: "g",
      costMultiplier: 0.25,
      markerUnknown: { nested: ["keep"] },
    });
    expect(next.providers.a?.models[0]?.unknownModel).toEqual({ nested: ["keep"] });
    expect(withUnknownMarker).toEqual(original);
  });

  it("creates a null-group marker without dropping the foreign PMM marker", () => {
    const original = structuredClone(source);

    const next = setMultiplier(source, "pmm", 0.5);

    expect(next.providers.pmm?.piModelFailover).toEqual({ group: null, costMultiplier: 0.5 });
    expect(next.providers.pmm?.piModelManager).toEqual({ managed: true });
    expect(source).toEqual(original);
  });

  it("ignores multiplier updates for missing providers", () => {
    const next = setMultiplier(source, "missing", 2);

    expect(next).toEqual(source);
    expect(next).not.toBe(source);
  });

  it("moves a provider key in place and preserves node data and key order", () => {
    const source: ModelsJson = {
      providers: {
        first: emptyProvider("first"),
        relay: {
          ...emptyProvider("relay"),
          unknownProvider: { nested: { keep: true } },
          piModelFailover: { group: "kg-1", costMultiplier: 0.2 },
        },
      },
    };
    const before = structuredClone(source);

    const next = renameProviderId(source, "relay", "renamed");

    expect(Object.keys(next.providers)).toEqual(["first", "renamed"]);
    expect(next.providers.renamed).toEqual(before.providers.relay);
    expect(source).toEqual(before);
    expect(next.providers).not.toBe(source.providers);
  });

  it.each([
    ["same id", "relay", "relay"],
    ["occupied destination", "relay", "other"],
    ["missing source", "absent", "renamed"],
  ])("leaves providers unchanged for %s", (_label, oldId, newId) => {
    const source: ModelsJson = {
      providers: {
        relay: emptyProvider("relay"),
        other: emptyProvider("other"),
      },
    };

    expect(renameProviderId(source, oldId, newId).providers).toEqual(source.providers);
  });
});
