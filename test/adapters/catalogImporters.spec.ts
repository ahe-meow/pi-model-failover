import { describe, expect, it, vi } from "vitest";
import {
  CatalogImportError,
  fetchEndpointModels,
  importPiBuiltinCatalog,
} from "../../src/adapters/catalogImporters.js";

const expectImportError = async (operation: Promise<unknown>, code: CatalogImportError["code"]) => {
  const error = await operation.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(CatalogImportError);
  expect((error as CatalogImportError).code).toBe(code);
  return error as CatalogImportError;
};

describe("catalog importers", () => {
  it("C2: imports fifty endpoint ids and normalizes /v1 once", async () => {
    const ids = Array.from({ length: 50 }, (_, index) => `m-${index}`);
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://relay.example/v1/models");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ Authorization: "Bearer sk-test-key", "X-Team": "blue" });
      return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
    });

    await expect(
      fetchEndpointModels(fetch, {
        baseUrl: "https://relay.example/v1/",
        apiKey: "sk-test-key",
        headers: { "X-Team": "blue" },
      }),
    ).resolves.toEqual(ids);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("C2: preserves supplied headers and omits Authorization without an api key", async () => {
    const headers = { "X-Team": "blue" };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toEqual(headers);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    await expect(
      fetchEndpointModels(fetch, { baseUrl: "https://relay.example", headers }),
    ).resolves.toEqual([]);
    expect(headers).toEqual({ "X-Team": "blue" });
  });

  it("C2: treats an empty api key as absent", async () => {
    const headers = { "X-Team": "blue" };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toEqual(headers);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    await expect(
      fetchEndpointModels(fetch, { baseUrl: "https://relay.example", apiKey: "", headers }),
    ).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-success response with a safe http error", async () => {
    const secret = "sk-test-key";
    const body = `upstream failure ${secret}`;
    const fetch = vi.fn(async () => new Response(body, { status: 503 }));

    const error = await expectImportError(
      fetchEndpointModels(fetch, { baseUrl: "https://relay.example", apiKey: secret }),
      "http",
    );

    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(body);
  });

  it("rejects malformed JSON with a safe invalid-json error", async () => {
    const body = '{"data": [malformed-body]';
    const fetch = vi.fn(async () => new Response(body, { status: 200 }));

    const error = await expectImportError(
      fetchEndpointModels(fetch, { baseUrl: "https://relay.example", apiKey: "sk-test-key" }),
      "invalid-json",
    );

    expect(error.message).not.toContain(body);
    expect(error.message).not.toContain("sk-test-key");
  });

  it("rejects response data entries without string ids", async () => {
    const body = JSON.stringify({ data: [{ id: "ok" }, {}, { id: 3 }] });
    const fetch = vi.fn(async () => new Response(body, { status: 200 }));

    const error = await expectImportError(
      fetchEndpointModels(fetch, { baseUrl: "https://relay.example" }),
      "invalid-body",
    );

    expect(error.message).not.toContain(body);
  });

  it("C3: imports built-in models without network access", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected network access"));
    const runtimeFactory = vi.fn(async () => ({
      getModels: () => [
        {
          provider: "openai",
          id: "gpt",
          name: "GPT",
          api: "openai-completions",
          reasoning: false,
          input: ["text"],
          contextWindow: 1000,
          maxTokens: 100,
          samplingParams: { temperature: 0.2, nested: { keep: true } },
        },
        {
          provider: "anthropic",
          id: "claude",
          name: "Claude",
          api: "anthropic-messages",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 2000,
          maxTokens: 500,
        },
      ],
    }));

    try {
      const catalog = await importPiBuiltinCatalog(runtimeFactory);

      expect(catalog).toEqual([
        {
          id: "gpt",
          name: "GPT",
          reasoning: false,
          vision: false,
          contextWindow: 1000,
          maxTokens: 100,
          defaults: { temperature: 0.2, nested: { keep: true } },
        },
        {
          id: "claude",
          name: "Claude",
          reasoning: true,
          vision: true,
          contextWindow: 2000,
          maxTokens: 500,
          defaults: {},
        },
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(runtimeFactory).toHaveBeenCalledTimes(1);
      expect(runtimeFactory).toHaveBeenCalledWith();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("omits an absent optional runtime name", async () => {
    const catalog = await importPiBuiltinCatalog(async () => ({
      getModels: () => [{ id: "unnamed", contextWindow: 1000, maxTokens: 100 }],
    }));

    expect(catalog[0]).toEqual({
      id: "unnamed",
      reasoning: false,
      vision: false,
      contextWindow: 1000,
      maxTokens: 100,
      defaults: {},
    });
    expect(catalog[0]).not.toHaveProperty("name");
  });

  it("deep-copies runtime sampling parameters", async () => {
    const samplingParams = { nested: { fromSource: true } };
    const catalog = await importPiBuiltinCatalog(async () => ({
      getModels: () => [
        {
          id: "copy-test",
          contextWindow: 1000,
          maxTokens: 100,
          samplingParams,
        },
      ],
    }));

    const outputModel = catalog[0];
    expect(outputModel).toBeDefined();
    if (outputModel === undefined) return;
    const outputNested = outputModel.defaults.nested as Record<string, unknown>;
    outputNested.fromOutput = true;
    expect(samplingParams.nested).not.toHaveProperty("fromOutput");

    samplingParams.nested.fromSource = false;
    expect(outputNested.fromSource).toBe(true);
  });

  const invalidNumericModels = [
    ["missing contextWindow", { id: "broken", maxTokens: 100 }],
    ["non-number contextWindow", { id: "broken", contextWindow: "100", maxTokens: 100 }],
    ["NaN contextWindow", { id: "broken", contextWindow: Number.NaN, maxTokens: 100 }],
    [
      "Infinity contextWindow",
      { id: "broken", contextWindow: Number.POSITIVE_INFINITY, maxTokens: 100 },
    ],
    ["missing maxTokens", { id: "broken", contextWindow: 1000 }],
    ["non-number maxTokens", { id: "broken", contextWindow: 1000, maxTokens: "100" }],
    ["NaN maxTokens", { id: "broken", contextWindow: 1000, maxTokens: Number.NaN }],
    [
      "Infinity maxTokens",
      { id: "broken", contextWindow: 1000, maxTokens: Number.POSITIVE_INFINITY },
    ],
  ] as const;

  it.each(invalidNumericModels)("rejects a runtime model with %s", async (_label, model) => {
    const error = await expectImportError(
      importPiBuiltinCatalog(async () => ({ getModels: () => [model] })),
      "runtime",
    );

    expect(error.message).toBe("Catalog import failed: runtime");
    expect(error.message).not.toContain("broken");
  });

  it("normalizes an injected non-runtime catalog error", async () => {
    const runtimeFactory = vi.fn(async () => ({
      getModels: () => {
        throw new CatalogImportError("invalid-body");
      },
    }));

    const error = await expectImportError(importPiBuiltinCatalog(runtimeFactory), "runtime");

    expect(error.message).toBe("Catalog import failed: runtime");
  });

  it("rejects a runtime model missing required numeric fields with a runtime error", async () => {
    const runtimeFactory = vi.fn(async () => ({
      getModels: () => [
        {
          id: "broken",
          reasoning: false,
          input: ["text"],
          maxTokens: 100,
        },
      ],
    }));

    const error = await expectImportError(importPiBuiltinCatalog(runtimeFactory), "runtime");

    expect(error.message).not.toContain("broken");
  });

  it("converts runtime failures to safe runtime errors", async () => {
    const runtimeFactory = vi.fn(async () => {
      throw new Error("runtime key sk-test-key");
    });

    const error = await expectImportError(importPiBuiltinCatalog(runtimeFactory), "runtime");

    expect(error.message).not.toContain("runtime key");
    expect(error.message).not.toContain("sk-test-key");
  });
});
