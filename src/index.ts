import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  ModelRuntime,
  type ProviderConfig,
  type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { createFailoverProvider, type ModelRegistryLike } from "./adapters/failoverProvider.js";
import { ModelsJsonFile } from "./adapters/modelsJson.js";
import { nodeFs } from "./adapters/nodeFs.js";
import { type PiRegistrar, Registrar } from "./adapters/registrar.js";
import { ConfigStore } from "./config/configStore.js";
import { SharedState } from "./config/sharedState.js";
import { WriteQueue } from "./config/writeQueue.js";
import { dropProvider } from "./domain/chains.js";
import { reset } from "./domain/cooldown.js";
import type {
  Chain,
  FailoverEvent,
  ModelNode,
  ModelsJson,
  ProviderNode,
  TargetRef,
} from "./domain/types.js";
import { HistoryLog } from "./history/historyLog.js";
import { S } from "./strings.js";
import { type AppDeps, createApp } from "./tui/app.js";

function hasStreamSimple(value: unknown): value is ProviderConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "streamSimple" in value &&
    typeof value.streamSimple === "function"
  );
}

export function toPiProviderConfig(value: unknown): ProviderConfig {
  if (typeof value !== "object" || value === null) return {};
  if (hasStreamSimple(value)) return value;
  const provider = value as ProviderNode;
  const models = provider.models.map((model: ModelNode) => ({
    id: model.id,
    name: model.name ?? model.id,
    ...(model.api === undefined ? {} : { api: model.api }),
    ...(model.baseUrl === undefined ? {} : { baseUrl: model.baseUrl }),
    reasoning: model.reasoning,
    ...(model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: model.thinkingLevelMap }),
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.headers === undefined ? {} : { headers: model.headers }),
  }));
  return {
    name: provider.name,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    ...(provider.api === undefined ? {} : { api: provider.api }),
    ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
    ...(provider.authHeader === undefined ? {} : { authHeader: provider.authHeader }),
    ...(provider.headers === undefined ? {} : { headers: provider.headers }),
    models,
  };
}

export type { Clock, Fetch, FileSystem } from "./domain/ports.js";
export type {
  ApiType,
  CatalogModel,
  Chain,
  ErrorHandlingMode,
  FailoverEvent,
  FailoverReason,
  FailureClass,
  KeyGroup,
  ModelNode,
  ModelsJson,
  ProviderNode,
  Settings,
  Target,
  TargetRef,
  TargetSettings,
  TargetState,
  TtftAction,
} from "./domain/types.js";

function targetRef(target: { provider: string; modelId: string }): TargetRef {
  return `${target.provider}/${target.modelId}` as TargetRef;
}

function manualEvent(ref: TargetRef, ts: string, sessionId: string): FailoverEvent {
  return { ts, sessionId, requestSeq: 0, from: ref, to: null, reason: "manual", elapsedMs: 0 };
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const runtimeFactory = async (): Promise<{ getModels(): unknown[] }> => {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    return { getModels: () => [...runtime.getModels()] };
  };
  const builtinRuntime = await runtimeFactory();
  const builtinProviderIds = new Set(
    builtinRuntime.getModels().flatMap((model) => {
      if (typeof model !== "object" || model === null || !("provider" in model)) return [];
      const provider = (model as { provider?: unknown }).provider;
      return typeof provider === "string" ? [provider] : [];
    }),
  );

  const dir = join(getAgentDir(), "pi-model-failover");
  await nodeFs.mkdir(dir, 0o700);
  const queue = new WriteQueue();
  const config = await ConfigStore.open(nodeFs, queue, dir);
  let latestNotify: ((message: string) => void) | undefined;
  const clock = {
    now: () => Date.now(),
    sleep: (milliseconds: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        const timer = setTimeout(resolve, milliseconds);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
  };
  const now = () => new Date(clock.now()).toISOString();
  const state = await SharedState.open(nodeFs, clock, queue, dir, (message) =>
    latestNotify?.(message),
  );
  const history = await HistoryLog.open(nodeFs, queue, dir);
  const modelsFile = new ModelsJsonFile(nodeFs, queue, join(getAgentDir(), "models.json"));
  let currentRegistry: ModelRegistryLike | undefined;
  type ThinkingLevel = Exclude<NonNullable<ExtensionContext["thinkingLevel"]>, "off">;
  let thinkingLevel: ThinkingLevel = "medium";
  const setThinkingLevel = (level: ExtensionContext["thinkingLevel"]): void => {
    if (level !== undefined) thinkingLevel = level === "off" ? "minimal" : level;
  };
  const sessionId = crypto.randomUUID();
  const piRegistrar: PiRegistrar = {
    registerProvider: (id, configValue) => pi.registerProvider(id, toPiProviderConfig(configValue)),
    unregisterProvider: (id) => pi.unregisterProvider(id),
    isBuiltin: (id) => builtinProviderIds.has(id),
  };
  const registrar = new Registrar(
    piRegistrar,
    (message) => latestNotify?.(message),
    (_chains: Chain[], currentModels: ModelsJson) =>
      createFailoverProvider({
        config,
        models: () => currentModels,
        registry: () => currentRegistry,
        state,
        history,
        clock,
        sessionId,
        thinkingLevel: () => thinkingLevel,
      }).config,
  );
  let models = await modelsFile.read();
  registrar.syncOwned(models);
  registrar.syncFailover(config.get().chains, models);

  const refresh = async (_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
    currentRegistry = ctx.modelRegistry;
    setThinkingLevel(ctx.thinkingLevel);
    models = await modelsFile.read();
    registrar.syncOwned(models);
    registrar.syncFailover(config.get().chains, models);
  };
  pi.on("session_start", refresh);

  const resetAll = async (): Promise<number> => {
    const targets = config.get().chains.flatMap((chain) => structuredClone(chain.targets));
    const timestamp = now();
    await state.update((states) => {
      for (const target of targets) states[targetRef(target)] = reset();
    });
    for (const target of targets)
      await history.append(manualEvent(targetRef(target), timestamp, sessionId));
    return targets.length;
  };

  pi.registerCommand("failover", {
    description: S.commandDescription,
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(S.needsTui, "warning");
        return;
      }

      currentRegistry = ctx.modelRegistry;
      setThinkingLevel(ctx.thinkingLevel);
      latestNotify = (message) => ctx.ui.notify(message, "warning");
      await ctx.ui.custom((_tui, _theme, _keybindings, done) => {
        const appDeps: AppDeps = {
          config,
          modelsFile,
          initialModels: models,
          models: () => models,
          state,
          history,
          registrar,
          notify: (message) => latestNotify?.(message),
          now,
          sessionId,
          createChainId: () => `chain-${crypto.randomUUID().slice(0, 8)}`,
          createKeyGroupId: () => crypto.randomUUID(),
          fetch: globalThis.fetch,
          runtimeFactory,
          memoryMode: () => state.isMemoryMode(),
          countTargets: () =>
            config.get().chains.reduce((count, chain) => count + chain.targets.length, 0),
          resetAll,
          afterProviderDelete: async (providerId, nextModels) => {
            models = structuredClone(nextModels);
            await config.update((value) => {
              value.chains = dropProvider(value.chains, providerId);
            });
            registrar.syncOwned(nextModels);
            registrar.syncFailover(config.get().chains, nextModels);
          },
          close: () => done(undefined),
        };
        const app = createApp(appDeps);
        return {
          ...app,
          invalidate: () => app.invalidate?.(),
        };
      });
    },
  });

  pi.on("session_shutdown", async () => {
    await state.flush();
    await history.flush();
  });
}
