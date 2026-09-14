import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { ModelRuntime, type ProviderConfig } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  createFailoverProvider,
  type ModelRegistryLike,
} from "../../src/adapters/failoverProvider.js";
import type { ConfigFile, ConfigStore } from "../../src/config/configStore.js";
import type { SharedState } from "../../src/config/sharedState.js";
import type { Clock } from "../../src/domain/ports.js";
import type {
  Chain,
  FailoverEvent,
  ModelsJson,
  ProviderNode,
  Settings,
  Target,
  TargetRef,
  TargetState,
} from "../../src/domain/types.js";
import type { HistoryLog } from "../../src/history/historyLog.js";
import { FakeClock } from "../fakes/fakeClock.js";

const PROVIDER_CONFIG_MARKER = "provider-config-placeholder";
const REQUEST_AUTH_MARKER = "request-auth-placeholder";
const RAW_PROVIDER_MARKER = "raw-provider-marker";
const RAW_BODY_MARKER = "raw-body-marker";

const settings = (overrides: Partial<Settings> = {}): Settings => ({
  listRows: 7,
  errorHandlingMode: "switch",
  maxRetries: 0,
  reasoningEffort: "medium",
  modelParameters: {},
  noProgressTimeoutSeconds: 90,
  ttftTimeoutSeconds: 60,
  ttftAction: "cooldown-only",
  ...overrides,
});

const target = (provider = "relay", overrides: Partial<Target> = {}): Target => ({
  provider,
  modelId: "m",
  ...overrides,
});

const chain = (targets: Target[] = [target()]): Chain => ({
  id: "coding",
  name: "Coding",
  targets,
});

const node = (id = "m"): ProviderNode["models"][number] => ({
  id,
  name: "Relay model",
  api: "openai-completions",
  reasoning: true,
  input: ["text"],
  contextWindow: 8_000,
  maxTokens: 1_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

const models = (): ModelsJson => ({
  providers: {
    relay: {
      name: "Relay",
      baseUrl: "https://relay.example/v1",
      api: "openai-completions",
      apiKey: PROVIDER_CONFIG_MARKER,
      models: [node()],
    },
  },
});

const makeModel = (id = "m", provider = "relay"): Model<Api> => ({
  id,
  name: id,
  api: "openai-completions",
  provider,
  baseUrl: `https://${provider}.example/v1`,
  reasoning: true,
  input: ["text"],
  contextWindow: 8_000,
  maxTokens: 1_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

const context = (): Context => ({ messages: [] });

const message = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: "openai-completions",
  provider: "relay",
  model: "m",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "pending",
  timestamp: 0,
  ...overrides,
});

const start = (): AssistantMessageEvent => ({ type: "start", partial: message() });
const textDelta = (delta = "hello"): AssistantMessageEvent => ({
  type: "text_delta",
  contentIndex: 0,
  delta,
  partial: message({ content: [{ type: "text", text: delta }] }),
});
const done = (): AssistantMessageEvent => ({
  type: "done",
  reason: "stop",
  message: message({
    content: [{ type: "text", text: "hello" }],
    stopReason: "stop",
  }),
});
const failure = (errorMessage: string): AssistantMessageEvent => ({
  type: "error",
  reason: "error",
  error: message({ stopReason: "error", errorMessage }),
});

const successfulStream = (): AssistantMessageEventStream => {
  const stream = createAssistantMessageEventStream();
  stream.push(start());
  stream.push(textDelta());
  stream.push(done());
  return stream;
};

const collect = async (stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> => {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

type StateUpdater = Parameters<SharedState["update"]>[0];

interface HarnessOptions {
  chains?: Chain[];
  registry?: ModelRegistryLike;
  streamFactory?: (call: number) => AssistantMessageEventStream;
  clock?: Clock;
  thinkingLevel?: ThinkingLevel;
  initialState?: Record<TargetRef, TargetState>;
  settings?: Partial<Settings>;
}

interface Harness {
  deps: Parameters<typeof createFailoverProvider>[0];
  registry: ModelRegistryLike;
  streamSimple: ReturnType<typeof vi.fn>;
  state: Record<TargetRef, TargetState>;
  history: FailoverEvent[];
  clock: Clock;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  let streamCalls = 0;
  const streamSimple = vi.fn(
    (_model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) => {
      const stream = options.streamFactory?.(streamCalls) ?? successfulStream();
      streamCalls++;
      return stream;
    },
  );
  const registry: ModelRegistryLike = options.registry ?? {
    find: vi.fn((provider: string, modelId: string) =>
      modelId === "m" ? makeModel(modelId, provider) : undefined,
    ),
    getProvider: vi.fn(() => ({ streamSimple })),
    getApiKeyAndHeaders: vi.fn(async () => ({
      ok: true as const,
      apiKey: REQUEST_AUTH_MARKER,
      headers: { "x-auth": "yes" },
      baseUrl: "https://resolved.example/v1",
      env: { REGION: "test" },
    })),
  };
  let state = structuredClone(options.initialState ?? {});
  const statePort = {
    read: vi.fn(async () => structuredClone(state)),
    update: vi.fn(async (fn: StateUpdater) => {
      const next = structuredClone(state);
      fn(next);
      state = next;
    }),
  } as unknown as SharedState;
  const history: FailoverEvent[] = [];
  const historyPort = {
    append: vi.fn(async (event: FailoverEvent) => history.push(structuredClone(event))),
  } as unknown as HistoryLog;
  const configValue: ConfigFile = {
    version: 1,
    settings: settings(options.settings),
    catalog: [],
    keyGroups: [],
    chains: options.chains ?? [chain()],
  };
  const config = { get: () => configValue } as unknown as ConfigStore;
  const deps: Parameters<typeof createFailoverProvider>[0] = {
    config,
    models,
    registry: () => registry,
    state: statePort,
    history: historyPort,
    clock: options.clock ?? new FakeClock(),
    sessionId: "session-1",
    thinkingLevel: () => options.thinkingLevel ?? "medium",
  };
  return {
    deps,
    registry,
    streamSimple,
    state,
    history,
    clock: deps.clock,
  };
}

function virtualModel(id = "coding"): Model<Api> {
  return makeModel(id, "failover");
}

describe("failover Provider adapter", () => {
  it("registers one Virtual Model per non-empty Chain", () => {
    const provider = createFailoverProvider(
      makeHarness({ chains: [chain(), { id: "empty", name: "Empty", targets: [] }] }).deps,
    );

    expect(provider.id).toBe("failover");
    expect(provider.config.models).toHaveLength(1);
    expect(provider.config.models?.[0]).toMatchObject({ id: "coding", name: "Coding" });
    expect(JSON.stringify(provider.config)).not.toContain(PROVIDER_CONFIG_MARKER);
  });

  it("registers runtime-compatible virtual models and invokes the adapter stream", async () => {
    const fetchSpy = vi.fn((..._args: Parameters<typeof globalThis.fetch>) =>
      Promise.reject(new Error("network must not be called")),
    );
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const harness = makeHarness({
        chains: [chain(), { id: "review", name: "Review", targets: [target()] }],
      });
      const provider = createFailoverProvider(harness.deps);
      expect(provider.config.api).toBe("pi-model-failover");
      expect(provider.config.baseUrl).toBe("https://failover.invalid");
      expect(provider.config.apiKey).toBe("unused");
      expect(provider.config.models?.every((model) => model.api === provider.config.api)).toBe(
        true,
      );

      const runtime = await ModelRuntime.create({
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.registerProvider(provider.id, provider.config as ProviderConfig);
      const registeredModels = ["coding", "review"].map((id) => {
        const registeredModel = runtime.getModel(provider.id, id);
        expect(registeredModel).toBeDefined();
        if (registeredModel === undefined) throw new Error(`runtime did not register ${id}`);
        return registeredModel;
      });
      expect(registeredModels.map((model) => model.id)).toEqual(["coding", "review"]);
      expect(registeredModels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            api: provider.config.api,
            baseUrl: provider.config.baseUrl,
          }),
        ]),
      );

      for (const registeredModel of registeredModels) {
        const outward = runtime.streamSimple(registeredModel, context());
        await expect(collect(outward)).resolves.toHaveLength(3);
      }
      expect(harness.streamSimple).toHaveBeenCalledTimes(2);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not forward the failover API key to a keyless target", async () => {
    const targetHeaders = { "x-target-auth": "yes" };
    const targetEnv = { REGION: "target" };
    const fetchSpy = vi.fn((..._args: Parameters<typeof globalThis.fetch>) =>
      Promise.reject(new Error("network must not be called")),
    );
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const harness = makeHarness();
      harness.registry.getApiKeyAndHeaders = vi.fn(async () => ({
        ok: true as const,
        headers: targetHeaders,
        env: targetEnv,
      }));
      const provider = createFailoverProvider(harness.deps);
      const runtime = await ModelRuntime.create({
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.registerProvider(provider.id, provider.config as ProviderConfig);
      const registeredModel = runtime.getModel(provider.id, "coding");
      expect(registeredModel).toBeDefined();
      if (registeredModel === undefined) throw new Error("runtime did not register virtual model");

      const outward = runtime.streamSimple(registeredModel, context());
      await expect(collect(outward)).resolves.toHaveLength(3);
      const requestOptions = harness.streamSimple.mock.calls[0]?.[2];
      expect(requestOptions).not.toHaveProperty("apiKey");
      expect(requestOptions?.headers).toEqual(targetHeaders);
      expect(requestOptions?.env).toEqual(targetEnv);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves a caller-supplied non-placeholder apiKey", async () => {
    const callerKey = "caller-key-preserved";
    const harness = makeHarness();
    harness.registry.getApiKeyAndHeaders = vi.fn(async () => ({
      ok: true as const,
      headers: { "x-target-auth": "yes" },
    }));
    const outward = createFailoverProvider(harness.deps).config.streamSimple?.(
      virtualModel(),
      context(),
      { apiKey: callerKey },
    );

    await collect(outward as AssistantMessageEventStream);
    expect(harness.streamSimple.mock.calls[0]?.[2]).toMatchObject({ apiKey: callerKey });
  });

  it("reports caller cancellation with an aborted terminal message", async () => {
    const upstream = createAssistantMessageEventStream();
    const harness = makeHarness({ streamFactory: () => upstream });
    const caller = new AbortController();
    const outward = createFailoverProvider(harness.deps).config.streamSimple?.(
      virtualModel(),
      context(),
      { signal: caller.signal },
    );

    await vi.waitFor(() => expect(harness.streamSimple).toHaveBeenCalledTimes(1));
    const collecting = collect(outward as AssistantMessageEventStream);
    caller.abort();
    const events = await collecting;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      reason: "aborted",
      error: { stopReason: "aborted" },
    });
    await expect((outward as AssistantMessageEventStream).result()).resolves.toMatchObject({
      stopReason: "aborted",
    });
    expect(harness.history).toHaveLength(0);
  });

  it("rejects an unknown chain without exposing a provider secret", () => {
    const provider = createFailoverProvider(makeHarness({ chains: [] }).deps);
    const streamSimple = provider.config.streamSimple;

    expect(streamSimple).toBeDefined();
    expect(() => streamSimple?.(virtualModel("missing"), context())).toThrow(/chain|model/i);
    expect(JSON.stringify(provider.config)).not.toContain(PROVIDER_CONFIG_MARKER);
  });

  it("forwards official start, text_delta, and done events without network access", async () => {
    const upstream = createAssistantMessageEventStream();
    const expected = [start(), textDelta(), done()];
    expected.forEach((event) => {
      upstream.push(event);
    });
    const fetchSpy = vi.fn((..._args: Parameters<typeof globalThis.fetch>) =>
      Promise.reject(new Error("network must not be called")),
    );
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const harness = makeHarness({ streamFactory: () => upstream });
      const outward = createFailoverProvider(harness.deps).config.streamSimple?.(
        virtualModel(),
        context(),
      );

      expect(outward).toBeDefined();
      const events = await collect(outward as AssistantMessageEventStream);
      expect(events).toEqual(expected);
      await expect((outward as AssistantMessageEventStream).result()).resolves.toEqual(
        (expected[2] as Extract<AssistantMessageEvent, { type: "done" }>).message,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("looks up the target model and auth, overlays parameters, and maps inherit thinking", async () => {
    const upstream = successfulStream();
    const harness = makeHarness({
      streamFactory: () => upstream,
      thinkingLevel: "high",
      chains: [
        chain([
          target("relay", {
            reasoningEffort: "inherit",
            modelParameters: { temperature: 0.2, top_p: 0.8 },
          }),
        ]),
      ],
    });
    const provider = createFailoverProvider(harness.deps);
    const outward = provider.config.streamSimple?.(virtualModel(), context(), {
      reasoning: "low",
      temperature: 0.1,
      maxTokens: 200,
    });

    await collect(outward as AssistantMessageEventStream);
    const registry = harness.registry;
    expect(registry.find).toHaveBeenCalledWith("relay", "m");
    expect(registry.getApiKeyAndHeaders).toHaveBeenCalledWith(makeModel());
    expect(registry.getProvider).toHaveBeenCalledWith("relay");
    expect(harness.streamSimple).toHaveBeenCalledTimes(1);
    const [requestModel, requestContext, requestOptions] = harness.streamSimple.mock.calls[0] ?? [];
    expect(requestModel).toMatchObject({
      provider: "relay",
      id: "m",
      baseUrl: "https://resolved.example/v1",
    });
    expect(requestContext).toEqual(context());
    expect(requestOptions).toMatchObject({
      reasoning: "high",
      temperature: 0.2,
      top_p: 0.8,
      maxTokens: 200,
      apiKey: REQUEST_AUTH_MARKER,
      headers: { "x-auth": "yes" },
      env: { REGION: "test" },
    });
    expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  it("removes a rejected compatibility parameter on the retry", async () => {
    const first = createAssistantMessageEventStream();
    first.push(failure('400: {"message":"Unknown parameter: temperature"}'));
    const second = successfulStream();
    const harness = makeHarness({
      streamFactory: (call) => (call === 0 ? first : second),
      chains: [chain([target("relay", { modelParameters: { temperature: 0.2 } })])],
    });
    const outward = createFailoverProvider(harness.deps).config.streamSimple?.(
      virtualModel(),
      context(),
      { temperature: 0.1 },
    );

    await collect(outward as AssistantMessageEventStream);
    expect(harness.streamSimple).toHaveBeenCalledTimes(2);
    expect(harness.streamSimple.mock.calls[0]?.[2]).toMatchObject({ temperature: 0.2 });
    expect(harness.streamSimple.mock.calls[1]?.[2]).not.toHaveProperty("temperature");
    expect(harness.history).toHaveLength(0);
  });

  it("passes an attempt-local signal and aborts it when TTFT switches targets", async () => {
    const clock = new (class implements Clock {
      now() {
        return 0;
      }

      readonly sleeps: number[] = [];
      private readonly waiters: Array<{ signal: AbortSignal | undefined; resolve: () => void }> =
        [];

      sleep(ms: number, signal?: AbortSignal): Promise<void> {
        this.sleeps.push(ms);
        return new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          this.waiters.push({ signal, resolve });
        });
      }

      release(ms: number) {
        if (ms !== 60_000) return;
        for (const waiter of this.waiters.splice(0)) waiter.resolve();
      }
    })();
    const hanging = createAssistantMessageEventStream();
    const harness = makeHarness({
      clock,
      streamFactory: (call) => (call === 0 ? hanging : successfulStream()),
      chains: [chain([target("relay", { ttftAction: "abort" }), target("backup")])],
    });
    const outward = createFailoverProvider(harness.deps).config.streamSimple?.(
      virtualModel(),
      context(),
    );
    const collecting = collect(outward as AssistantMessageEventStream);
    await vi.waitFor(() => expect(harness.streamSimple).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(clock.sleeps).toContain(60_000));
    const firstSignal = harness.streamSimple.mock.calls[0]?.[2]?.signal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    clock.release(60_000);

    await expect(collecting).resolves.toHaveLength(3);
    expect(firstSignal?.aborted).toBe(true);
  });

  it("converts terminal provider errors to a redacted outward error", async () => {
    const upstream = createAssistantMessageEventStream();
    upstream.push(
      failure(`503: raw response body contains ${RAW_PROVIDER_MARKER} and ${RAW_BODY_MARKER}`),
    );
    const harness = makeHarness({ streamFactory: () => upstream });
    const outward = createFailoverProvider(harness.deps).config.streamSimple?.(
      virtualModel(),
      context(),
    );

    const events = await collect(outward as AssistantMessageEventStream);
    const result = await (outward as AssistantMessageEventStream).result();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", reason: "error" });
    expect(JSON.stringify(events)).not.toContain(RAW_PROVIDER_MARKER);
    expect(JSON.stringify(events)).not.toContain(RAW_BODY_MARKER);
    expect(JSON.stringify(result)).not.toContain(RAW_PROVIDER_MARKER);
    expect(JSON.stringify(result)).not.toContain(RAW_BODY_MARKER);
  });
});
