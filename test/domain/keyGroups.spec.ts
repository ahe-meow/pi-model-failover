import { describe, expect, it } from "vitest";
import { createKeyGroup, nextFreeSuffix } from "../../src/domain/keyGroups.js";
import type { KeyGroup } from "../../src/domain/types.js";

const template: KeyGroup["template"] = {
  baseUrl: "https://relay.example/v1",
  api: "openai-completions",
  headers: { "X-Team": "a" },
};

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
};

describe("key group construction", () => {
  it("C1: creates twenty suffixed providers with ownership markers", () => {
    const result = createKeyGroup({
      prefix: "relay",
      template,
      keys: Array.from({ length: 20 }, (_, i) => ({ key: `sk-key-${i}`, multiplier: 0.1 })),
      now: "2026-09-09T00:00:00.000Z",
      id: "kg-1",
    });

    expect(Object.keys(result.providers)).toEqual(
      Array.from({ length: 20 }, (_, i) => `relay-${i + 1}`),
    );
    expect(result.group).toEqual({
      id: "kg-1",
      prefix: "relay",
      template,
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    expect(result.group).not.toHaveProperty("keys");

    for (const [id, provider] of Object.entries(result.providers)) {
      const index = Number(id.split("-")[1]) - 1;
      expect(provider.apiKey).toBe(`sk-key-${index}`);
      expect(provider.models).toEqual([]);
      expect(provider.piModelFailover).toEqual({ group: "kg-1", costMultiplier: 0.1 });
    }
  });

  it("C1: continues after occupied and same-batch ids with the default multiplier", () => {
    const result = createKeyGroup({
      prefix: "relay",
      template,
      keys: [{ key: "one" }, { key: "two" }],
      now: "now",
      id: "kg-2",
      existingIds: ["relay-1", "relay-3"],
    });

    expect(Object.keys(result.providers)).toEqual(["relay-2", "relay-4"]);
    expect(result.providers["relay-2"]?.piModelFailover?.costMultiplier).toBe(1);
  });

  it("C1: returns the smallest free suffix and ignores another prefix", () => {
    const existing = ["other-1", "relay-2", "relay-4"];

    expect(nextFreeSuffix(existing, "relay")).toBe(1);
    expect(nextFreeSuffix(existing, "other")).toBe(2);
    expect(existing).toEqual(["other-1", "relay-2", "relay-4"]);
  });

  it("C1: avoids an occupied suffix when creating one provider", () => {
    const result = createKeyGroup({
      prefix: "relay",
      template,
      keys: [{ key: "only" }],
      now: "now",
      id: "kg-3",
      existingIds: ["relay-1"],
    });

    expect(Object.keys(result.providers)).toEqual(["relay-2"]);
  });

  it("C1: creates exactly one provider and one api key per key entry", () => {
    const result = createKeyGroup({
      prefix: "relay",
      template,
      keys: [{ key: "first" }, { key: "second", multiplier: 2 }],
      now: "now",
      id: "kg-4",
    });

    expect(Object.keys(result.providers)).toHaveLength(2);
    expect(Object.values(result.providers).map((provider) => provider.apiKey)).toEqual([
      "first",
      "second",
    ]);
    expect(Object.values(result.providers).every((provider) => provider.models.length === 0)).toBe(
      true,
    );
  });

  it("C1: clones template data and does not mutate frozen inputs", () => {
    const inputTemplate = deepFreeze<KeyGroup["template"]>({
      baseUrl: "https://relay.example/v1",
      api: "openai-completions",
      headers: { "X-Team": "a" },
    });
    const inputKeys = deepFreeze([{ key: "secret", multiplier: 0.5 }]);
    const inputIds = deepFreeze(["relay-2"]);

    const result = createKeyGroup({
      prefix: "relay",
      template: inputTemplate,
      keys: inputKeys,
      now: "now",
      id: "kg-5",
      existingIds: inputIds,
    });

    expect(result.group.template).toEqual(inputTemplate);
    expect(result.group.template).not.toBe(inputTemplate);
    expect(result.group.template.headers).not.toBe(inputTemplate.headers);
    expect(result.providers["relay-1"]?.headers).toEqual(inputTemplate.headers);
    expect(result.providers["relay-1"]?.headers).not.toBe(inputTemplate.headers);
    expect(result.providers["relay-1"]?.headers).not.toBe(result.group.template.headers);
    expect(inputTemplate).toEqual({
      baseUrl: "https://relay.example/v1",
      api: "openai-completions",
      headers: { "X-Team": "a" },
    });
    expect(inputKeys).toEqual([{ key: "secret", multiplier: 0.5 }]);
    expect(inputIds).toEqual(["relay-2"]);
  });

  it("C1: rejects an empty key batch", () => {
    expect(() =>
      createKeyGroup({
        prefix: "relay",
        template,
        keys: [],
        now: "now",
        id: "kg-empty",
      }),
    ).toThrow("keys must not be empty");
  });

  it.each([
    ["zero", 0],
    ["negative", -0.1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ] as const)("C1: rejects a %s multiplier", (_label, multiplier) => {
    expect(() =>
      createKeyGroup({
        prefix: "relay",
        template,
        keys: [{ key: "secret", multiplier }],
        now: "now",
        id: "kg-invalid",
      }),
    ).toThrow("multiplier must be positive");
  });
});
