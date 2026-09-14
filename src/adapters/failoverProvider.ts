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
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { ConfigStore } from "../config/configStore.js";
import type { SharedState } from "../config/sharedState.js";
import { virtualModelNode } from "../domain/chains.js";
import { type Attempt, type EngineDeps, runChain, type StreamChunk } from "../domain/engine.js";
import type { Clock } from "../domain/ports.js";
import type { ModelsJson, TargetRef, TargetSettings } from "../domain/types.js";
import type { HistoryLog } from "../history/historyLog.js";
import { S } from "../strings.js";

export type ResolvedRequestAuth =
  | {
      ok: true;
      apiKey?: string;
      headers?: Record<string, string | null>;
      baseUrl?: string;
      env?: Record<string, string>;
    }
  | { ok: false; error: string };

export interface ModelRegistryLike {
  find(provider: string, modelId: string): Model<Api> | undefined;
  getProvider(provider: string):
    | {
        streamSimple(
          model: Model<Api>,
          context: Context,
          options?: SimpleStreamOptions,
        ): AssistantMessageEventStream;
      }
    | undefined;
  getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth>;
}

export interface FailoverProviderDeps {
  config: ConfigStore;
  models: () => ModelsJson;
  registry: () => ModelRegistryLike | undefined;
  state: SharedState;
  history: HistoryLog;
  clock: Clock;
  sessionId: string;
  thinkingLevel: () => ThinkingLevel;
}

type FailureError = Error & {
  status?: number;
  code?: string;
  body?: string;
  sentParams: string[];
};

type FailureDetails = {
  status?: number;
  code?: string;
  body?: string;
};

const COMPATIBILITY_PARAMS = [
  "reasoning_effort",
  "temperature",
  "max_completion_tokens",
  "thinking",
] as const;
const FAILOVER_API = "pi-model-failover";
const FAILOVER_BASE_URL = "https://failover.invalid";
const FAILOVER_API_KEY = "unused";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function parseFailureMessage(value: string): FailureDetails {
  const statusMatch =
    value.match(/\bHTTP\s+([1-5]\d{2})\b/i) ??
    value.match(/\bstatus(?:\s+code)?\s*[:=]?\s*([1-5]\d{2})\b/i) ??
    value.match(/\(([1-5]\d{2})\)/u) ??
    value.match(/^(?:[^\d]*?)([1-5]\d{2})(?=\s*[:\s]|$)/u);
  const body =
    statusMatch === null
      ? value.trim()
      : value
          .slice((statusMatch.index ?? 0) + statusMatch[0].length)
          .replace(/^\s*[:)]\s*/u, "")
          .trim();
  return {
    ...(statusMatch?.[1] === undefined ? {} : { status: Number(statusMatch[1]) }),
    ...(body.length === 0 ? {} : { body }),
  };
}

function failureError(details: FailureDetails, sentParams: string[]): FailureError {
  const error = new Error(S.appTitle) as FailureError;
  if (details.status !== undefined) error.status = details.status;
  if (details.code !== undefined) error.code = details.code;
  if (details.body !== undefined) error.body = details.body;
  error.sentParams = [...sentParams];
  return error;
}

function normalizeFailure(
  value: unknown,
  sentParams: string[],
  defaultStatus?: number,
): FailureError {
  const record = asRecord(value);
  const nested = asRecord(record.error);
  const messageValue =
    typeof record.errorMessage === "string"
      ? record.errorMessage
      : typeof nested.errorMessage === "string"
        ? nested.errorMessage
        : typeof record.message === "string"
          ? record.message
          : typeof nested.message === "string"
            ? nested.message
            : undefined;
  const messageDetails = messageValue === undefined ? {} : parseFailureMessage(messageValue);
  const statusValue = record.status ?? nested.status ?? messageDetails.status ?? defaultStatus;
  const codeValue = record.code ?? nested.code;
  const bodyValue = record.body ?? nested.body ?? messageDetails.body;
  return failureError(
    {
      ...(typeof statusValue === "number" ? { status: statusValue } : {}),
      ...(typeof codeValue === "string" ? { code: codeValue } : {}),
      ...(typeof bodyValue === "string" ? { body: bodyValue } : {}),
    },
    sentParams,
  );
}

function thinkingFor(
  reasoningEffort: TargetSettings["reasoningEffort"],
  inherit: ThinkingLevel,
): ThinkingLevel {
  return reasoningEffort === "inherit" ? inherit : reasoningEffort;
}

function targetParts(ref: TargetRef): { provider: string; modelId: string } {
  const slash = ref.indexOf("/");
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

function toProviderModel(
  node: NonNullable<ReturnType<typeof virtualModelNode>>,
): NonNullable<ProviderConfig["models"]>[number] {
  // SAFETY: virtualModelNode returns a complete model shape; only the adapter-owned API/name fields are overridden.
  return { ...node, api: FAILOVER_API, name: node.name ?? node.id } as unknown as NonNullable<
    ProviderConfig["models"]
  >[number];
}

function meaningful(event: AssistantMessageEvent): boolean {
  return (
    (event.type === "text_delta" ||
      event.type === "thinking_delta" ||
      event.type === "toolcall_delta") &&
    event.delta.length > 0
  );
}

function toChunk(event: AssistantMessageEvent): StreamChunk {
  if (event.type === "done") return { payload: event, meaningful: false, done: true };
  return { payload: event, meaningful: meaningful(event) };
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function terminalMessage(
  model: Model<Api>,
  clock: Clock,
  stopReason: "error" | "aborted" = "error",
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: "failover",
    model: model.id,
    usage: emptyUsage(),
    stopReason,
    errorMessage: S.appTitle,
    timestamp: clock.now(),
  };
}

function terminalEvent(model: Model<Api>, clock: Clock, aborted = false): AssistantMessageEvent {
  return {
    type: "error",
    reason: aborted ? "aborted" : "error",
    error: terminalMessage(model, clock, aborted ? "aborted" : "error"),
  };
}

function linkAbortSignal(signal: AbortSignal, controller: AbortController): () => void {
  const abort = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export function createFailoverProvider(deps: FailoverProviderDeps): {
  id: "failover";
  config: ProviderConfig;
} {
  const models = deps.config.get().chains.flatMap((chain) => {
    const projected = virtualModelNode(chain, deps.models());
    return projected === null ? [] : [toProviderModel(projected)];
  });
  let requestSeq = 0;

  const send = async (
    target: TargetRef,
    targetSettings: TargetSettings,
    stripped: string[],
    attemptSignal: AbortSignal,
    context: Context,
    baseOptions: SimpleStreamOptions,
  ): Promise<Attempt> => {
    const { provider: providerId, modelId } = targetParts(target);
    const registry = deps.registry();
    const sentOptions: Record<string, unknown> = {
      ...baseOptions,
      ...targetSettings.modelParameters,
      reasoning: thinkingFor(targetSettings.reasoningEffort, deps.thinkingLevel()),
    };
    if (sentOptions.apiKey === FAILOVER_API_KEY) delete sentOptions.apiKey;
    for (const parameter of stripped) delete sentOptions[parameter];
    const sentParams = COMPATIBILITY_PARAMS.filter((parameter) => parameter in sentOptions);

    if (registry === undefined) throw failureError({ status: 503 }, sentParams);
    const model = registry.find(providerId, modelId);
    if (model === undefined) throw failureError({ status: 404 }, sentParams);

    let auth: ResolvedRequestAuth;
    try {
      auth = await registry.getApiKeyAndHeaders(model);
    } catch (error) {
      throw normalizeFailure(error, sentParams, 401);
    }
    if (!auth.ok) throw failureError({ status: 401 }, sentParams);

    const controller = new AbortController();
    const unlink = linkAbortSignal(attemptSignal, controller);
    const requestModel = auth.baseUrl === undefined ? model : { ...model, baseUrl: auth.baseUrl };
    sentOptions.signal = controller.signal;
    if (auth.apiKey !== undefined) sentOptions.apiKey = auth.apiKey;
    if (auth.headers !== undefined) sentOptions.headers = auth.headers;
    if (auth.env !== undefined) sentOptions.env = auth.env;

    let upstream: AssistantMessageEventStream;
    try {
      const provider = registry.getProvider(providerId);
      if (provider === undefined) throw failureError({ status: 404 }, sentParams);
      upstream = provider.streamSimple(requestModel, context, sentOptions as SimpleStreamOptions);
    } catch (error) {
      unlink();
      throw normalizeFailure(error, sentParams);
    }

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unlink();
    };
    return {
      events: (async function* () {
        try {
          for await (const event of upstream) {
            if (event.type === "error") throw normalizeFailure(event.error, sentParams);
            yield toChunk(event);
          }
        } catch (error) {
          throw normalizeFailure(error, sentParams);
        } finally {
          cleanup();
        }
      })(),
      abort: () => {
        controller.abort();
        cleanup();
      },
    };
  };

  const config: ProviderConfig = {
    api: FAILOVER_API,
    baseUrl: FAILOVER_BASE_URL,
    apiKey: FAILOVER_API_KEY,
    models,
    streamSimple(model, context, options) {
      const chain = deps.config.get().chains.find((entry) => entry.id === model.id);
      if (chain === undefined) throw new Error(S.commandDescription);

      const stream = createAssistantMessageEventStream();
      const requestController = new AbortController();
      const unlink = options?.signal
        ? linkAbortSignal(options.signal, requestController)
        : () => {};
      const baseOptions = options === undefined ? {} : { ...options };
      const sequence = requestSeq++;
      void (async () => {
        let finalMessage: AssistantMessage | undefined;
        try {
          const engineDeps: EngineDeps = {
            send: (target, targetSettings, stripped, signal) =>
              send(target, targetSettings, stripped, signal, context, baseOptions),
            state: deps.state,
            history: deps.history,
            clock: deps.clock,
            sessionId: deps.sessionId,
          };
          for await (const event of runChain(
            engineDeps,
            chain,
            deps.config.get().settings,
            sequence,
            requestController.signal,
          )) {
            if (!isAssistantMessageEvent(event)) continue;
            stream.push(event);
            if (event.type === "done") finalMessage = event.message;
          }
          if (finalMessage !== undefined) stream.end(finalMessage);
          else stream.end(terminalMessage(model, deps.clock));
        } catch {
          stream.push(terminalEvent(model, deps.clock, requestController.signal.aborted));
        } finally {
          unlink();
        }
      })();
      return stream;
    },
  };

  return { id: "failover", config };
}

function isAssistantMessageEvent(value: unknown): value is AssistantMessageEvent {
  return (
    typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
  );
}
