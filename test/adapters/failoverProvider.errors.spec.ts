import type {
  Api,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createFailoverProvider } from "../../src/adapters/failoverProvider.js";
import type { ConfigStore } from "../../src/config/configStore.js";
import type { SharedState } from "../../src/config/sharedState.js";
import type { Clock } from "../../src/domain/ports.js";
import type {
  Chain,
  ModelsJson,
  ProviderNode,
  Settings,
  TargetRef,
  TargetState,
} from "../../src/domain/types.js";
import type { HistoryLog } from "../../src/history/historyLog.js";

const defaultSettings: Settings = {
  listRows: 7,
  errorHandlingMode: "switch",
  maxRetries: 0,
  reasoningEffort: "inherit",
  modelParameters: {},
  noProgressTimeoutSeconds: 90,
  ttftTimeoutSeconds: 60,
  serverQuality: { enabled: true, ttft: true, noProgress: true },
};
const target = (provider: string, modelId: string) => ({ provider, modelId });
const chain: Chain = {
  id: "coding",
  name: "Coding Chain",
  targets: [target("relay", "m"), target("backup", "n")],
};
const model = (provider: string, id: string): Model<Api> => ({
  id,
  name: id,
  api: "openai-completions",
  provider,
  baseUrl: `https://${provider}.example/v1`,
  reasoning: false,
  input: ["text"],
  contextWindow: 8_000,
  maxTokens: 1_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const provider = (id: string, idForModel: string): ProviderNode => ({
  name: id,
  baseUrl: `https://${id}.example/v1`,
  api: "openai-completions",
  models: [
    {
      id: idForModel,
      name: idForModel,
      reasoning: false,
      input: ["text"],
      contextWindow: 8_000,
      maxTokens: 1_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
});
const context: Context = { messages: [] };
const clock: Clock = { now: () => 0, sleep: async () => {} };

function makeFailureRegistry(failure: Record<string, unknown>) {
  const streamSimple = (_model: Model<Api>, _context: Context): AssistantMessageEventStream => {
    throw failure;
  };
  return {
    find: (providerId: string, modelId: string) => model(providerId, modelId),
    getProvider: () => ({ streamSimple }),
    getApiKeyAndHeaders: async () => ({ ok: true as const }),
  };
}

function makeDeps(
  failure: Record<string, unknown> = {
    status: 503,
    body: "upstream api_key=super-secret",
  },
  settingsOverrides: Partial<Settings> = {},
) {
  let state: Record<TargetRef, TargetState> = {};
  const history: unknown[] = [];
  const config = {
    get: () => ({
      version: 2,
      settings: { ...defaultSettings, ...settingsOverrides },
      catalog: [],
      keyGroups: [],
      chains: [chain],
    }),
  } as unknown as ConfigStore;
  return {
    config,
    models: () =>
      ({
        providers: { relay: provider("relay", "m"), backup: provider("backup", "n") },
      }) as ModelsJson,
    registry: () => makeFailureRegistry(failure),
    state: {
      read: async () => structuredClone(state),
      update: async (fn: (value: Record<TargetRef, TargetState>) => void) => {
        const next = structuredClone(state);
        fn(next);
        state = next;
      },
    } as unknown as SharedState,
    history: {
      append: async (event: unknown) => {
        history.push(event);
      },
    } as unknown as HistoryLog,
    clock,
    sessionId: "session-1",
    thinkingLevel: () => "medium" as const,
    historyRecords: history,
  };
}

async function collect(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("detailed final failover errors", () => {
  it("reports chain, final target, status, and reason without the raw response body", async () => {
    const deps = makeDeps();
    const outward = createFailoverProvider(deps).config.streamSimple?.(
      {
        id: "coding",
        name: "Coding Chain",
        api: "pi-model-failover",
        provider: "failover",
        baseUrl: "https://failover.invalid",
        reasoning: false,
        input: ["text"],
        contextWindow: 8_000,
        maxTokens: 1_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      } as Model<Api>,
      context,
    );
    expect(outward).toBeDefined();
    const events = await collect(outward as AssistantMessageEventStream);
    const message = String(
      (events[0] as Extract<AssistantMessageEvent, { type: "error" }>).error.errorMessage,
    );

    expect(events).toHaveLength(1);
    expect(message).toContain("Coding Chain");
    expect(message).toContain("coding");
    expect(message).toContain("backup/n");
    expect(message).toContain("503");
    expect(message).toContain("http-503");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("api_key");
    expect(message).not.toBe("pi-model-failover");
  });

  it("reports network failures with the final target and no raw credential text", async () => {
    const deps = makeDeps({ code: "ECONNRESET", body: "Authorization: Bearer raw-secret" });
    const outward = createFailoverProvider(deps).config.streamSimple?.(
      {
        id: "coding",
        name: "Coding Chain",
        api: "pi-model-failover",
        provider: "failover",
        baseUrl: "https://failover.invalid",
        reasoning: false,
        input: ["text"],
        contextWindow: 8_000,
        maxTokens: 1_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      } as Model<Api>,
      context,
    );
    const events = await collect(outward as AssistantMessageEventStream);
    const message = String(
      (events[0] as Extract<AssistantMessageEvent, { type: "error" }>).error.errorMessage,
    );

    expect(message).toContain("backup/n");
    expect(message).toContain("network");
    expect(message).toContain("unknown");
    expect(message).not.toContain("raw-secret");
    expect(message).not.toContain("Authorization");
  });

  it("reports the final target after retry exhaustion", async () => {
    const deps = makeDeps({ status: 503 }, { errorHandlingMode: "retry", maxRetries: 1 });
    const outward = createFailoverProvider(deps).config.streamSimple?.(
      {
        id: "coding",
        name: "Coding Chain",
        api: "pi-model-failover",
        provider: "failover",
        baseUrl: "https://failover.invalid",
        reasoning: false,
        input: ["text"],
        contextWindow: 8_000,
        maxTokens: 1_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      } as Model<Api>,
      context,
    );
    const events = await collect(outward as AssistantMessageEventStream);
    const message = String(
      (events[0] as Extract<AssistantMessageEvent, { type: "error" }>).error.errorMessage,
    );

    expect(deps.historyRecords).toHaveLength(2);
    expect(message).toContain("backup/n");
    expect(message).toContain("status 503");
    expect(message).toContain("http-503");
  });
});
