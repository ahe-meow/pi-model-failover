import { resolveTargetSettings } from "./chains.js";
import {
  applyFailure,
  applyManualRecovery,
  applySuccess,
  backoffMs,
  isExcluded,
  reset,
} from "./cooldown.js";
import { classify, type FailureInput } from "./failureClass.js";
import type { Clock } from "./ports.js";
import { redactFailureBody } from "./redact.js";
import { isServerQualityEnabled } from "./serverQuality.js";
import type {
  Chain,
  FailoverErrorDetails,
  FailoverEvent,
  FailoverReason,
  Settings,
  Target,
  TargetRef,
  TargetSettings,
  TargetState,
} from "./types.js";

export interface Attempt {
  events: AsyncIterable<StreamChunk>;
  abort(): void;
}

export interface StreamChunk {
  meaningful: boolean;
  payload: unknown;
  done?: boolean;
}
export type FallbackNotice = { from: TargetRef; to: TargetRef | null; reason: FailoverReason };
export interface EngineDeps {
  send(
    target: TargetRef,
    settings: TargetSettings,
    stripped: string[],
    signal: AbortSignal,
  ): Promise<Attempt>;
  state: {
    read(): Promise<Record<TargetRef, TargetState>>;
    update(fn: (targets: Record<TargetRef, TargetState>) => void): Promise<void>;
  };
  history: { append(event: FailoverEvent): Promise<void> };
  clock: Clock;
  sessionId: string;
  onTargetAttempt?: (target: TargetRef) => void;
  onFallback?: (notice: FallbackNotice) => void;
}
type Candidate = { ref: TargetRef; target: Target; index: number };
type TimerKind = "ttft" | "no-progress";
type NextResult =
  | { kind: "next"; result: IteratorResult<StreamChunk> }
  | { kind: "error"; error: unknown };
type RaceResult =
  | NextResult
  | { kind: "timer"; timer: TimerKind }
  | { kind: "cancelled-timer" }
  | { kind: "parent" };
type AttemptResult =
  | { kind: "success"; payloads: unknown[] }
  | { kind: "failure"; error: unknown; input: FailureInput }
  | { kind: "cancelled" };
type ActiveTimer = { controller: AbortController; promise: Promise<RaceResult> };

const targetRef = (target: Target): TargetRef =>
  `${target.provider}/${target.modelId}` as TargetRef;

function abortError(): Error {
  const error = new Error("request aborted");
  error.name = "AbortError";
  return error;
}

function safeAbort(attempt: Attempt): void {
  try {
    attempt.abort();
  } catch {
    return;
  }
}

function asFailure(value: unknown, fallbackParams: string[]): FailureInput {
  const record: Record<string, unknown> =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const input: FailureInput = {
    sentParams: Array.isArray(record.sentParams)
      ? record.sentParams.filter((param): param is string => typeof param === "string")
      : [...fallbackParams],
  };
  if (typeof record.status === "number") input.status = record.status;
  if (typeof record.code === "string") input.code = record.code;
  if (typeof record.body === "string") input.body = record.body;
  if (record.timer === "ttft" || record.timer === "no-progress") input.timer = record.timer;
  return input;
}

function failureDetails(input: FailureInput): FailoverErrorDetails | undefined {
  const details: FailoverErrorDetails = {
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.body === undefined ? {} : { body: redactFailureBody(input.body) }),
  };
  return Object.keys(details).length === 0 ? undefined : details;
}

function nextResult(iterator: AsyncIterator<StreamChunk>): Promise<NextResult> {
  return iterator.next().then(
    (result) => ({ kind: "next", result }),
    (error: unknown) => ({ kind: "error", error }),
  );
}

function timerResult(
  clock: Clock,
  milliseconds: number,
  controller: AbortController,
  timer: TimerKind,
): Promise<RaceResult> {
  return Promise.resolve()
    .then(() => clock.sleep(milliseconds, controller.signal))
    .then(
      () => ({ kind: "timer", timer }) as const,
      () => ({ kind: "cancelled-timer" }) as const,
    );
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() =>
    signal.removeEventListener("abort", onAbort),
  );
}

function timerFailure(attempt: Attempt, timer: TimerKind, stripped: string[]): AttemptResult {
  safeAbort(attempt);
  const failure: FailureInput = { timer, sentParams: [...stripped] };
  return { kind: "failure", error: failure, input: failure };
}

async function consumeAttempt(
  attempt: Attempt,
  settings: TargetSettings,
  stripped: string[],
  clock: Clock,
  signal: AbortSignal,
): Promise<AttemptResult> {
  if (signal.aborted) return { kind: "cancelled" };
  const iterator = attempt.events[Symbol.asyncIterator]();
  const payloads: unknown[] = [];
  let activeTimer: ActiveTimer | undefined;
  const stopTimer = () => {
    activeTimer?.controller.abort();
    activeTimer = undefined;
  };
  const startTimer = (timer: TimerKind, milliseconds: number) => {
    if (milliseconds <= 0) return;
    const controller = new AbortController();
    activeTimer = { controller, promise: timerResult(clock, milliseconds, controller, timer) };
  };
  let resolveParent!: () => void;
  const parentPromise = new Promise<RaceResult>((resolve) => {
    resolveParent = () => resolve({ kind: "parent" });
  });
  const onParentAbort = () => resolveParent();
  signal.addEventListener("abort", onParentAbort, { once: true });
  if (isServerQualityEnabled(settings.serverQuality, "ttft")) {
    startTimer("ttft", settings.ttftTimeoutSeconds * 1_000);
  }

  try {
    let next = nextResult(iterator);
    while (true) {
      const contenders: Array<Promise<RaceResult>> = [next, parentPromise];
      if (activeTimer !== undefined) contenders.push(activeTimer.promise);
      const result = await Promise.race(contenders);
      if (result.kind === "parent") return { kind: "cancelled" };
      if (result.kind === "cancelled-timer") {
        if (signal.aborted) return { kind: "cancelled" };
        activeTimer = undefined;
        continue;
      }
      if (result.kind === "timer") {
        activeTimer = undefined;
        return timerFailure(attempt, result.timer, stripped);
      }
      if (result.kind === "error") {
        return signal.aborted
          ? { kind: "cancelled" }
          : {
              kind: "failure",
              error: result.error,
              input: asFailure(result.error, stripped),
            };
      }
      if (result.result.done) return { kind: "success", payloads };
      const chunk = result.result.value;
      payloads.push(chunk.payload);
      if (chunk.done) return { kind: "success", payloads };
      if (chunk.meaningful) {
        stopTimer();
        if (isServerQualityEnabled(settings.serverQuality, "no-progress")) {
          startTimer("no-progress", settings.noProgressTimeoutSeconds * 1_000);
        }
      }
      next = nextResult(iterator);
    }
  } finally {
    stopTimer();
    signal.removeEventListener("abort", onParentAbort);
  }
}

function candidatesFor(
  chain: Chain,
  states: Record<TargetRef, TargetState>,
  now: number,
): Candidate[] {
  const all = chain.targets.map((target, index) => ({ target, ref: targetRef(target), index }));
  const normal = all.filter(({ ref }) => !isExcluded(states[ref], now));
  return normal.length > 0 ? normal : all.filter(({ ref }) => !states[ref]?.manualRecovery);
}

async function recordFailure(
  deps: EngineDeps,
  ref: TargetRef,
  to: TargetRef | null,
  reason: FailoverReason,
  persistent: boolean,
  requestSeq: number,
  startedAt: number,
  input?: FailureInput,
): Promise<void> {
  const now = deps.clock.now();
  const details = input === undefined ? undefined : failureDetails(input);
  await deps.state.update((targets) => {
    const current = targets[ref] ?? reset();
    targets[ref] = persistent
      ? applyManualRecovery(current, now, reason)
      : applyFailure(current, reason, now);
  });
  await deps.history.append({
    ts: new Date(now).toISOString(),
    sessionId: deps.sessionId,
    requestSeq,
    from: ref,
    to,
    reason,
    elapsedMs: Math.max(0, now - startedAt),
    ...(details === undefined ? {} : { error: details }),
  });
  deps.onFallback?.({ from: ref, to, reason });
}
function shouldRetry(
  mode: TargetSettings["errorHandlingMode"],
  cls: ReturnType<typeof classify>["cls"],
  reason: FailoverReason,
  retries: number,
  maxRetries: number,
): boolean {
  if (retries >= Math.max(0, maxRetries)) return false;
  return (
    mode === "retry" ||
    (mode === "smart" &&
      (cls === "server-quality" || reason === "network" || reason === "http-429"))
  );
}

async function waitForRetry(
  clock: Clock,
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  try {
    await clock.sleep(milliseconds, signal);
  } catch (error) {
    if (signal.aborted) throw abortError();
    throw error;
  }
}

export async function* runChain(
  deps: EngineDeps,
  chain: Chain,
  settings: Settings,
  requestSeq: number,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  const startedAt = deps.clock.now();
  if (signal.aborted) throw abortError();
  const states = await deps.state.read();
  if (signal.aborted) throw abortError();
  const candidates = candidatesFor(chain, states, deps.clock.now());
  if (candidates.length === 0) throw new Error("no targets available");

  let lastError: unknown = new Error("all targets failed");
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const targetSettings = resolveTargetSettings(candidate.target, settings);
    const stripped: string[] = [];
    const nextTarget = chain.targets[candidate.index + 1];
    const nextRef = nextTarget === undefined ? null : targetRef(nextTarget);
    const record = (
      reason: FailoverReason,
      persistent = false,
      to = nextRef,
      input?: FailureInput,
    ) => recordFailure(deps, candidate.ref, to, reason, persistent, requestSeq, startedAt, input);
    let retries = 0;
    while (true) {
      if (signal.aborted) throw abortError();
      deps.onTargetAttempt?.(candidate.ref);
      const controller = new AbortController();
      let attempt: Attempt | undefined;
      const onParentAbort = () => {
        controller.abort();
        if (attempt !== undefined) safeAbort(attempt);
      };
      signal.addEventListener("abort", onParentAbort, { once: true });
      let outcome: AttemptResult;
      try {
        const sent = Promise.resolve().then(() =>
          deps.send(candidate.ref, targetSettings, [...stripped], controller.signal),
        );
        sent.then(
          (lateAttempt) => {
            if (signal.aborted) safeAbort(lateAttempt);
          },
          () => {},
        );
        attempt = await raceWithAbort(sent, signal);
        outcome = signal.aborted
          ? { kind: "cancelled" }
          : await consumeAttempt(attempt, targetSettings, stripped, deps.clock, signal);
      } catch (error) {
        outcome = signal.aborted
          ? { kind: "cancelled" }
          : { kind: "failure", error, input: asFailure(error, stripped) };
      } finally {
        signal.removeEventListener("abort", onParentAbort);
        controller.abort();
      }

      if (outcome.kind === "cancelled") throw abortError();
      if (outcome.kind === "success") {
        await deps.state.update((targets) => {
          targets[candidate.ref] = applySuccess(targets[candidate.ref] ?? reset());
        });
        if (signal.aborted) throw abortError();
        for (const payload of outcome.payloads) yield payload;
        return;
      }

      lastError = outcome.error;
      let classification = classify(outcome.input);
      if (classification.cls === "compat-retry" && classification.offendingParam !== undefined) {
        if (!stripped.includes(classification.offendingParam)) {
          stripped.push(classification.offendingParam);
          continue;
        }
        // A repeated compatibility rejection is treated as an ordinary cooldown failure.
        classification = { cls: "cooldown", reason: classification.reason };
      }
      if (classification.cls === "persistent") {
        await record(classification.reason, true, nextRef, outcome.input);
        break;
      }
      if (
        shouldRetry(
          targetSettings.errorHandlingMode,
          classification.cls,
          classification.reason,
          retries,
          targetSettings.maxRetries,
        )
      ) {
        await waitForRetry(deps.clock, backoffMs(retries), signal);
        retries++;
        continue;
      }
      await record(classification.reason, false, nextRef, outcome.input);
      break;
    }
  }
  throw lastError;
}
