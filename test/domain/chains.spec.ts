import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  addTargets,
  chainsReferencing,
  dropProvider,
  moveTarget,
  removeChain,
  removeTarget,
  renameChain,
  renameProviderRefs,
  resolveTargetSettings,
  sameModelImport,
  sortTargetsByCostMultiplier,
  upsertChain,
  virtualModelNode,
} from "../../src/domain/chains.js";
import type {
  Chain,
  ModelNode,
  ModelsJson,
  ProviderNode,
  Settings,
  Target,
  TargetRef,
} from "../../src/domain/types.js";
import { normalizeThinkingLevelMap } from "../../src/domain/types.js";

const model = (id: string, overrides: Partial<ModelNode> = {}): ModelNode => ({
  id,
  name: `${id} display`,
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  ...overrides,
});

const supportedThinkingLevels = (thinkingLevelMap: ModelNode["thinkingLevelMap"]) =>
  getSupportedThinkingLevels({
    ...model("m"),
    api: "openai-completions",
    provider: "relay",
    thinkingLevelMap,
  } as unknown as Model<Api>);

const provider = (id: string, ...models: ModelNode[]): ProviderNode => ({
  name: id,
  baseUrl: "",
  api: "openai-completions",
  models,
});

const chain = (targets: Target[] = [{ provider: "a", modelId: "m" }]): Chain => ({
  id: "coding",
  name: "Coding",
  targets,
});

const settings: Settings = {
  listRows: 7,
  errorHandlingMode: "smart",
  maxRetries: 5,
  reasoningEffort: "inherit",
  modelParameters: { temperature: 0.2, nested: { keep: true } },
  noProgressTimeoutSeconds: 90,
  ttftTimeoutSeconds: 60,
  ttftAction: "cooldown-only",
};

describe("chains", () => {
  it("C7: dropProvider removes only matching targets and preserves chains", () => {
    const input = [
      chain([
        { provider: "relay", modelId: "m" },
        { provider: "keep", modelId: "m" },
      ]),
      chain([{ provider: "relay", modelId: "n" }]),
    ];

    const result = dropProvider(input, "relay");

    expect(result).toEqual([chain([{ provider: "keep", modelId: "m" }]), chain([])]);
    expect(result).not.toBe(input);
    expect(result[0]).not.toBe(input[0]);
    expect(input[0]?.targets).toHaveLength(2);
  });

  it("rejects failover targets", () => {
    expect(() => addTargets(chain([]), ["failover/x"])).toThrow();
  });

  it("deduplicates existing and repeated refs while appending independent targets", () => {
    const input = chain([{ provider: "keep", modelId: "m", maxRetries: 2 }]);

    const result = addTargets(input, ["keep/m", "new/one", "new/one", "new/two"]);

    expect(result.targets).toEqual([
      { provider: "keep", modelId: "m", maxRetries: 2 },
      { provider: "new", modelId: "one" },
      { provider: "new", modelId: "two" },
    ]);
    expect(result.targets[0]).not.toBe(input.targets[0]);
    expect(input.targets).toEqual([{ provider: "keep", modelId: "m", maxRetries: 2 }]);
  });

  it("renames a chain in place without changing its target order", () => {
    const input = [
      chain([{ provider: "relay", modelId: "m" }]),
      { ...chain([]), id: "review", name: "Review" },
    ];

    const result = renameChain(input, "coding", "primary", "Primary");

    expect(result.map(({ id }) => id)).toEqual(["primary", "review"]);
    expect(result[0]).toEqual({
      id: "primary",
      name: "Primary",
      targets: [{ provider: "relay", modelId: "m" }],
    });
    expect(result[0]).not.toBe(input[0]);
    expect(input[0]?.id).toBe("coding");
  });

  it("normalizes reasoning maps for Pi and preserves non-reasoning maps", () => {
    const allLevels = {
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    };
    const supported = ["off", "low", "medium", "high", "xhigh", "max"];

    const defaultMap = normalizeThinkingLevelMap(true);
    expect(defaultMap).toEqual({ xhigh: "xhigh", max: "max", minimal: null });
    expect(supportedThinkingLevels(defaultMap)).toEqual(supported);

    const legacyMap = normalizeThinkingLevelMap(true, allLevels);
    expect(legacyMap).toEqual({ ...allLevels, minimal: null });
    expect(supportedThinkingLevels(legacyMap)).toEqual(supported);

    const explicitNullMap = normalizeThinkingLevelMap(true, { ...allLevels, minimal: null });
    expect(explicitNullMap).toEqual({ ...allLevels, minimal: null });
    expect(supportedThinkingLevels(explicitNullMap)).toEqual(supported);

    const nonReasoningMap = { minimal: "minimal", high: "high" };
    expect(normalizeThinkingLevelMap(false, nonReasoningMap)).toEqual(nonReasoningMap);

    const source = model("m", { thinkingLevelMap: allLevels });
    const projected = virtualModelNode(chain(), { providers: { a: provider("a", source) } });
    expect(projected?.thinkingLevelMap).toEqual({ ...allLevels, minimal: null });
    expect(supportedThinkingLevels(projected?.thinkingLevelMap)).toEqual(supported);
  });

  it("normalizes persisted minimal reasoning effort to low", () => {
    const resolved = resolveTargetSettings(
      { provider: "a", modelId: "m", reasoningEffort: "minimal" } as unknown as Target,
      settings,
    );
    expect(resolved.reasoningEffort).toBe("low");
  });

  it("moves a target by one position and clones an out-of-range result", () => {
    const input = chain([
      { provider: "a", modelId: "a" },
      { provider: "b", modelId: "b" },
      { provider: "c", modelId: "c" },
    ]);

    expect(moveTarget(input, 1, 1).targets).toEqual([
      { provider: "a", modelId: "a" },
      { provider: "c", modelId: "c" },
      { provider: "b", modelId: "b" },
    ]);
    const unchanged = moveTarget(input, 0, -1);
    expect(unchanged).toEqual(input);
    expect(unchanged).not.toBe(input);
    expect(unchanged.targets).not.toBe(input.targets);
    expect(input.targets.map(({ provider: id }) => id)).toEqual(["a", "b", "c"]);
  });

  it("upserts by id and removes only the requested chain", () => {
    const original = [chain([{ provider: "a", modelId: "m" }]), { ...chain([]), id: "review" }];
    const replacement = { ...chain([{ provider: "b", modelId: "m" }]), name: "Review" };

    const updated = upsertChain(original, replacement);
    const appended = upsertChain(original, { ...chain([]), id: "new", name: "New" });
    const removed = removeChain(original, "coding");

    expect(updated).toEqual([replacement, original[1]]);
    expect(updated[0]).not.toBe(replacement);
    expect(appended.map(({ id }) => id)).toEqual(["coding", "review", "new"]);
    expect(removed).toEqual([original[1]]);
    expect(original[0]?.targets).toEqual([{ provider: "a", modelId: "m" }]);
  });

  it("removes exact target refs and finds chains containing a provider", () => {
    const input = [
      chain([
        { provider: "relay", modelId: "m" },
        { provider: "keep", modelId: "m" },
      ]),
      { ...chain([{ provider: "other", modelId: "m" }]), id: "review" },
    ];

    const firstChain = input[0];
    if (!firstChain) throw new Error("expected first chain");
    const removed = removeTarget(firstChain, "relay/m" as TargetRef);
    const matching = chainsReferencing(input, "relay");

    expect(removed.targets).toEqual([{ provider: "keep", modelId: "m" }]);
    expect(matching).toEqual([input[0]]);
    expect(matching[0]).not.toBe(input[0]);
    expect(input[0]?.targets).toHaveLength(2);
  });

  it("C16: same-model import preserves provider multiplier ordering", () => {
    const models: ModelsJson = {
      providers: {
        b: {
          ...provider("b", model("m")),
          piModelFailover: { group: null, costMultiplier: 1 },
        },
        a: {
          ...provider("a", model("m")),
          piModelFailover: { group: null, costMultiplier: 0.1 },
        },
        c: {
          ...provider("c", model("m")),
          piModelFailover: { group: null, costMultiplier: 0.1 },
        },
      },
    };

    expect(sameModelImport(chain([]), models, "m").targets).toEqual([
      { provider: "a", modelId: "m" },
      { provider: "c", modelId: "m" },
      { provider: "b", modelId: "m" },
    ]);
  });

  it("sorts targets stably by multiplier in both directions without mutating input", () => {
    const input: Target[] = [
      { provider: "high", modelId: "m" },
      { provider: "low-first", modelId: "m" },
      { provider: "missing", modelId: "m" },
      { provider: "low-second", modelId: "m" },
    ];
    const models: ModelsJson = {
      providers: {
        high: {
          ...provider("high", model("m")),
          piModelFailover: { group: null, costMultiplier: 2 },
        },
        "low-first": {
          ...provider("low-first", model("m")),
          piModelFailover: { group: null, costMultiplier: 0.5 },
        },
        missing: provider("missing", model("m")),
        "low-second": {
          ...provider("low-second", model("m")),
          piModelFailover: { group: null, costMultiplier: 0.5 },
        },
      },
    };

    const ascending = sortTargetsByCostMultiplier(input, models, "asc");
    const descending = sortTargetsByCostMultiplier(input, models, "desc");

    expect(ascending.map(({ provider: id }) => id)).toEqual([
      "low-first",
      "low-second",
      "missing",
      "high",
    ]);
    expect(descending.map(({ provider: id }) => id)).toEqual([
      "high",
      "missing",
      "low-first",
      "low-second",
    ]);
    expect(ascending).not.toBe(input);
    expect(ascending[0]).not.toBe(input[1]);
    expect(input.map(({ provider: id }) => id)).toEqual([
      "high",
      "low-first",
      "missing",
      "low-second",
    ]);
  });

  it("projects the first target and returns null for empty or missing targets", () => {
    const source = model("m", {
      reasoning: false,
      input: ["text"],
      contextWindow: 2000,
      maxTokens: 200,
      headers: { "X-Model": "keep" },
      compat: { nested: { keep: true } },
      unknownModel: { preserved: [1, 2, 3] },
    });
    const models: ModelsJson = { providers: { a: provider("a", source) } };

    expect(virtualModelNode(chain([]), models)).toBeNull();
    expect(virtualModelNode(chain(), { providers: {} })).toBeNull();
    expect(virtualModelNode(chain(), models)).toEqual({
      ...source,
      id: "coding",
      name: "Coding",
    });
    const projected = virtualModelNode(chain(), models);
    expect(projected).not.toBe(source);
    expect(projected?.cost).not.toBe(source.cost);
  });

  it("resolves target settings with an overriding, deeply copied parameter object", () => {
    const target: Target = {
      provider: "a",
      modelId: "m",
      errorHandlingMode: "retry",
      maxRetries: 2,
      reasoningEffort: "high",
      modelParameters: { temperature: 0.8, nested: { keep: false } },
      noProgressTimeoutSeconds: 30,
      ttftTimeoutSeconds: 10,
      ttftAction: "abort",
    };

    const resolved = resolveTargetSettings(target, settings);

    expect(resolved).toEqual({
      errorHandlingMode: "retry",
      maxRetries: 2,
      reasoningEffort: "high",
      modelParameters: { temperature: 0.8, nested: { keep: false } },
      noProgressTimeoutSeconds: 30,
      ttftTimeoutSeconds: 10,
      ttftAction: "abort",
    });
    expect(resolved.modelParameters).not.toBe(target.modelParameters);
    expect(resolved.modelParameters.nested).not.toBe(target.modelParameters?.nested);

    const inherited = resolveTargetSettings({ provider: "a", modelId: "m" }, settings);
    expect(inherited).toEqual({
      errorHandlingMode: "smart",
      maxRetries: 5,
      reasoningEffort: "inherit",
      modelParameters: { temperature: 0.2, nested: { keep: true } },
      noProgressTimeoutSeconds: 90,
      ttftTimeoutSeconds: 60,
      ttftAction: "cooldown-only",
    });
    expect(inherited.modelParameters).not.toBe(settings.modelParameters);
    expect(inherited.modelParameters.nested).not.toBe(settings.modelParameters.nested);
  });

  it("rewrites only the renamed provider reference and preserves target settings", () => {
    const input: Chain[] = [
      chain([
        { provider: "relay", modelId: "m", maxRetries: 2 },
        { provider: "keep", modelId: "m" },
      ]),
      { ...chain([{ provider: "relay", modelId: "n" }]), id: "review" },
    ];
    const before = structuredClone(input);

    const next = renameProviderRefs(input, "relay", "renamed");

    expect(next[0]?.targets).toEqual([
      { provider: "renamed", modelId: "m", maxRetries: 2 },
      { provider: "keep", modelId: "m" },
    ]);
    expect(next[1]?.targets).toEqual([{ provider: "renamed", modelId: "n" }]);
    expect(input).toEqual(before);
  });

  it("returns an unlinked clone when the provider id is unchanged", () => {
    const input: Chain[] = [chain()];

    const next = renameProviderRefs(input, "relay", "relay");

    expect(next).toEqual(input);
    expect(next).not.toBe(input);
    expect(next[0]).not.toBe(input[0]);
  });
});
