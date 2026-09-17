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
import { dropProvider, renameProviderRefs } from "./domain/chains.js";
import { reset } from "./domain/cooldown.js";
import type {
  Chain,
  FailoverEvent,
  ModelNode,
  ModelsJson,
  ProviderNode,
  TargetRef,
} from "./domain/types.js";
import { normalizeThinkingLevelMap } from "./domain/types.js";
import { HistoryLog } from "./history/historyLog.js";
import { S } from "./strings.js";
import { type AppDeps, createApp } from "./tui/app.js";
import {
  createFooterState,
  FOOTER_STATUS_KEYS,
  type FooterState,
  footerStatusValues,
  updateCurrentTarget,
  updateFallback,
} from "./tui/footer.js";
import type { ModelsFileUpdateOptions } from "./tui/tabs/modelManager/types.js";

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
  const models = provider.models.map((model: ModelNode) => {
    const thinkingLevelMap = normalizeThinkingLevelMap(model.reasoning, model.thinkingLevelMap);
    return {
      id: model.id,
      name: model.name ?? model.id,
      ...(model.api === undefined ? {} : { api: model.api }),
      ...(model.baseUrl === undefined ? {} : { baseUrl: model.baseUrl }),
      reasoning: model.reasoning,
      ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(model.headers === undefined ? {} : { headers: model.headers }),
    };
  });
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
  ServerQualityOverride,
  ServerQualitySettings,
  ServerQualitySignal,
} from "./domain/serverQuality.js";
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
  ReasoningEffort,
  ReasoningLevel,
  Settings,
  Target,
  TargetRef,
  TargetSettings,
  TargetState,
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
  let footerState: FooterState = createFooterState();
  const retainedFallback = (await history.list()).events.find(
    (event) => event.to !== null && event.reason !== "manual",
  );
  if (retainedFallback !== undefined) footerState = updateFallback(footerState, retainedFallback);
  let statusContext: ExtensionContext | undefined;
  const updateStatuses = (ctx = statusContext): void => {
    if (ctx?.mode !== "tui" || typeof ctx.ui.setStatus !== "function") return;
    const values = footerStatusValues(footerState);
    ctx.ui.setStatus(FOOTER_STATUS_KEYS.current, values.current);
    ctx.ui.setStatus(FOOTER_STATUS_KEYS.fallback, values.fallback);
  };
  const setStatusContext = (ctx: ExtensionContext): void => {
    statusContext = ctx.mode === "tui" ? ctx : undefined;
    updateStatuses();
  };
  const updateStatusState = (next: FooterState): void => {
    if (next === footerState) return;
    footerState = next;
    updateStatuses();
  };

  const modelsFile = new ModelsJsonFile(nodeFs, queue, join(getAgentDir(), "models.json"));
  let currentRegistry: ModelRegistryLike | undefined;
  type ThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;
  let thinkingLevel: ThinkingLevel = "medium";
  const setThinkingLevel = (level: ExtensionContext["thinkingLevel"]): void => {
    if (level !== undefined) thinkingLevel = level;
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
        onTargetAttempt: (target) => {
          updateStatusState(updateCurrentTarget(footerState, target));
        },
        onFallback: (notice) => {
          updateStatusState(updateFallback(footerState, notice));
        },
        thinkingLevel: () => thinkingLevel,
      }).config,
  );
  let models = await modelsFile.read();
  registrar.syncOwned(models);
  registrar.syncFailover(config.get().chains, models);
  const modelManagerModelsFile: AppDeps["modelsFile"] = {
    read: () => modelsFile.read(),
    update: async (update, options?: ModelsFileUpdateOptions) => {
      const next = await modelsFile.update(update);
      models = structuredClone(next);
      if (!options?.deferFailoverSync) registrar.syncFailover(config.get().chains, next);
      return next;
    },
  };

  const refresh = async (event: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
    if (event.reason !== "reload") footerState = { ...footerState, currentTarget: null };
    currentRegistry = ctx.modelRegistry;
    setThinkingLevel(ctx.thinkingLevel);
    models = await modelsFile.read();
    setStatusContext(ctx);
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

  const useModel = async (providerId: string, modelId: string): Promise<void> => {
    const ref = `${providerId}/${modelId}`;
    const model = currentRegistry?.find(providerId, modelId);
    if (model === undefined) {
      latestNotify?.(S.modelSwitch.unavailable);
      return;
    }
    try {
      const applied = await pi.setModel(model);
      latestNotify?.(applied ? S.modelSwitch.selected(ref) : S.modelSwitch.authMissing(ref));
    } catch {
      latestNotify?.(S.modelSwitch.failed);
    }
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
      setStatusContext(ctx);
      latestNotify = (message) => ctx.ui.notify(message, "warning");
      await ctx.ui.custom((_tui, _theme, _keybindings, done) => {
        const appDeps: AppDeps = {
          config,
          modelsFile: modelManagerModelsFile,
          initialModels: models,
          models: () => models,
          state,
          history,
          registrar,
          notify: (message) => latestNotify?.(message),
          useModel,
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
            await config.update((value) => {
              value.chains = dropProvider(value.chains, providerId);
            });
            registrar.syncOwned(nextModels);
            registrar.syncFailover(config.get().chains, nextModels);
          },
          afterProviderRename: async (previousId, providerId, nextModels) => {
            await config.update((value) => {
              value.chains = renameProviderRefs(value.chains, previousId, providerId);
            });
            await state.update((targets) => {
              for (const [key, current] of Object.entries(targets)) {
                const slash = key.indexOf("/");
                if (slash < 1 || key.slice(0, slash) !== previousId) continue;
                const renamed = `${providerId}${key.slice(slash)}` as TargetRef;
                if (targets[renamed] === undefined) targets[renamed] = current;
                delete targets[key as TargetRef];
              }
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
