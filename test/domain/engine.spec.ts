import { describe, expect, it } from "vitest";
import { applyFailure, applyManualRecovery, reset } from "../../src/domain/cooldown.js";
import {
  type Attempt,
  type EngineDeps,
  runChain,
  type StreamChunk,
} from "../../src/domain/engine.js";
import type { Clock } from "../../src/domain/ports.js";
import type {
  Chain,
  FailoverEvent,
  Settings,
  Target,
  TargetRef,
  TargetState,
} from "../../src/domain/types.js";
import { FakeClock } from "../fakes/fakeClock.js";

type Failure = {
  status?: number;
  code?: string;
  body?: string;
  timer?: "ttft" | "no-progress";
  sentParams?: string[];
};
const settings = (overrides: Partial<Settings> = {}): Settings => ({
  listRows: 7,
  errorHandlingMode: "smart",
  maxRetries: 5,
  reasoningEffort: "inherit",
  modelParameters: { temperature: 0.2 },
  noProgressTimeoutSeconds: 90,
  ttftTimeoutSeconds: 60,
  serverQuality: { enabled: true, ttft: true, noProgress: true },
  ...overrides,
});
const target = (provider: string, overrides: Partial<Target> = {}): Target => ({
  provider,
  modelId: "m",
  ...overrides,
});
const chainOf = (...targets: Target[]): Chain => ({ id: "coding", name: "Coding", targets });
const chainABC = chainOf(target("a"), target("b"), target("c"));
const chainAB = (a: Partial<Target> = {}, b: Partial<Target> = {}): Chain =>
  chainOf(target("a", a), target("b", b));
const signal = new AbortController().signal;
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function successfulAttempt(...payloads: unknown[]): Attempt {
  const chunks: StreamChunk[] = payloads.map((payload, index) => ({
    meaningful: true,
    payload,
    done: index === payloads.length - 1,
  }));
  return {
    events: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    abort: () => {},
  };
}
function throwingAttempt(failure: Failure): Attempt {
  const error = { ...failure, sentParams: failure.sentParams ?? [] };
  return {
    events: (async function* () {
      yield* [] as StreamChunk[];
      throw error;
    })(),
    abort: () => {},
  };
}
interface ControlledAttempt {
  attempt: Attempt;
  release: () => void;
  aborts: () => number;
}
type GateMode = "before" | "after-nonmeaningful" | "after-meaningful" | "only";
function gatedAttempt(mode: GateMode, payload: unknown): ControlledAttempt {
  const gate = deferred();
  let abortCount = 0;
  return {
    attempt: {
      events: (async function* () {
        if (mode === "after-nonmeaningful" || mode === "after-meaningful") {
          yield { meaningful: mode === "after-meaningful", payload };
        }
        await gate.promise;
        if (mode === "before") {
          yield { meaningful: true, payload };
          yield { meaningful: false, payload: "done", done: true };
        }
        if (mode === "after-meaningful") yield { meaningful: false, payload: "done", done: true };
      })(),
      abort: () => {
        abortCount++;
        gate.resolve();
      },
    },
    release: gate.resolve,
    aborts: () => abortCount,
  };
}
const waitBeforeMeaningful = (payload: unknown): ControlledAttempt =>
  gatedAttempt("before", payload);
const waitAfterMeaningful = (payload: unknown): ControlledAttempt =>
  gatedAttempt("after-meaningful", payload);
const pendingAttempt = (): ControlledAttempt => gatedAttempt("only", undefined);
class ObservableClock extends FakeClock {
  readonly sleeps: number[] = [];
  override sleep(ms: number, signal?: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    return super.sleep(ms, signal);
  }
}
class AdvancingClock extends FakeClock {
  readonly sleeps: number[] = [];
  override sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error("aborted"));
    this.sleeps.push(ms);
    this.advance(ms);
    return Promise.resolve();
  }
}
interface Harness {
  deps: EngineDeps;
  state: EngineDeps["state"] & {
    reads: number;
    updates: number;
    snapshot: () => Record<TargetRef, TargetState>;
  };
  history: FailoverEvent[];
  clock: Clock;
}
function makeEngine(options: {
  send: EngineDeps["send"];
  initialState?: Record<TargetRef, TargetState>;
  history?: FailoverEvent[];
  clock?: Clock;
}): Harness {
  let current = structuredClone(options.initialState ?? {});
  const state: Harness["state"] = {
    reads: 0,
    updates: 0,
    async read() {
      state.reads++;
      return structuredClone(current);
    },
    async update(fn) {
      state.updates++;
      const next = structuredClone(current);
      fn(next);
      current = next;
    },
    snapshot: () => structuredClone(current),
  };
  const history = options.history ?? [];
  const clock = options.clock ?? new FakeClock();
  return {
    state,
    history,
    clock,
    deps: {
      send: options.send,
      state,
      history: {
        append: async (event) => {
          history.push(structuredClone(event));
        },
      },
      clock,
      sessionId: "session-1",
    },
  };
}
async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const payloads: unknown[] = [];
  for await (const payload of stream) payloads.push(payload);
  return payloads;
}
async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}
describe("runChain", () => {
  it("C8: switches on HTTP 503, cools A, and records one event", async () => {
    const sent: string[] = [];
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      send: async (ref) => {
        sent.push(ref);
        return ref === "a/m" ? throwingAttempt({ status: 503 }) : successfulAttempt("from-b");
      },
      history,
    });
    await expect(
      collect(runChain(deps.deps, chainAB(), settings(), 7, new AbortController().signal)),
    ).resolves.toEqual(["from-b"]);
    expect(sent).toEqual(["a/m", "b/m"]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      from: "a/m",
      to: "b/m",
      reason: "http-503",
      sessionId: "session-1",
      requestSeq: 7,
      elapsedMs: 0,
    });
    expect(history[0]?.error).toEqual({ status: 503 });
    expect(deps.state.snapshot()["a/m"]?.cooldownLevel).toBe(1);
    expect(deps.state.snapshot()["b/m"]).toEqual(reset());
  });
  it("C9: persistent failure enters Manual Recovery and is skipped later", async () => {
    const sent: string[] = [];
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      send: async (ref) => {
        sent.push(ref);
        return ref === "a/m" ? throwingAttempt({ status: 401 }) : successfulAttempt("from-b");
      },
      history,
    });
    await expect(
      collect(runChain(deps.deps, chainAB(), settings(), 1, new AbortController().signal)),
    ).resolves.toEqual(["from-b"]);
    await expect(
      collect(runChain(deps.deps, chainAB(), settings(), 2, new AbortController().signal)),
    ).resolves.toEqual(["from-b"]);
    expect(sent).toEqual(["a/m", "b/m", "b/m"]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: "a/m", to: "b/m", reason: "http-401" });
    expect(history[0]?.error).toEqual({ status: 401 });
    expect(deps.state.snapshot()["a/m"]?.manualRecovery).toBe(true);
  });
  it("disabled TTFT continues the provider stream without failover", async () => {
    const clock = new ObservableClock();
    const first = waitBeforeMeaningful("from-a");
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      clock,
      history,
      send: async (ref) => (ref === "a/m" ? first.attempt : successfulAttempt("from-b")),
    });
    const running = collect(
      runChain(deps.deps, chainAB({ serverQuality: { ttft: false } }), settings(), 3, signal),
    );
    await waitFor(() => deps.state.reads === 1);
    expect(clock.sleeps).not.toContain(60_000);
    first.release();
    await expect(running).resolves.toEqual(["from-a", "done"]);
    expect(history).toHaveLength(0);
  });
  it("disabled no-progress continues the provider stream without failover", async () => {
    const clock = new ObservableClock();
    const first = waitAfterMeaningful("partial-from-a");
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      clock,
      history,
      send: async (ref) => (ref === "a/m" ? first.attempt : successfulAttempt("from-b")),
    });
    const running = collect(
      runChain(deps.deps, chainAB({ serverQuality: { noProgress: false } }), settings(), 4, signal),
    );
    await waitFor(() => deps.state.reads === 1);
    expect(clock.sleeps).not.toContain(90_000);
    first.release();
    await expect(running).resolves.toEqual(["partial-from-a", "done"]);
    expect(history).toHaveLength(0);
  });
  it("records the real HTTP reason and normalized error detail for a persistent failure", async () => {
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      history,
      send: async (ref) =>
        ref === "a/m"
          ? throwingAttempt({ status: 401, code: "invalid_api_key", body: "invalid api key" })
          : successfulAttempt("from-b"),
    });
    await expect(collect(runChain(deps.deps, chainAB(), settings(), 21, signal))).resolves.toEqual([
      "from-b",
    ]);
    expect(history[0]).toMatchObject({
      from: "a/m",
      to: "b/m",
      reason: "http-401",
      error: { status: 401, code: "invalid_api_key", body: "invalid api key" },
    });
    expect(deps.state.snapshot()["a/m"]?.manualRecovery).toBe(true);
  });
  it("redacts secrets before writing an error body to history", async () => {
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      history,
      send: async (ref) =>
        ref === "a/m"
          ? throwingAttempt({ status: 503, body: "upstream rejected api_key=abcdefgh" })
          : successfulAttempt("from-b"),
    });
    await collect(runChain(deps.deps, chainAB(), settings(), 22, signal));
    expect(history[0]?.error?.body).toBe("upstream rejected api_key=abc…efgh");
  });
  it.each(["smart", "retry"] as const)(
    "%s retries server-quality failures with the shared budget and backoff",
    async (mode) => {
      for (const makeAttempt of [
        () => waitBeforeMeaningful("timed-out"),
        () => waitAfterMeaningful("stalled"),
      ]) {
        const clock = new AdvancingClock();
        const sent: string[] = [];
        const history: FailoverEvent[] = [];
        let aAttempts = 0;
        const deps = makeEngine({
          clock,
          history,
          send: async (ref) => {
            sent.push(ref);
            if (ref !== "a/m") return successfulAttempt("from-b");
            if (aAttempts++ < 2) return makeAttempt().attempt;
            return successfulAttempt("recovered-a");
          },
        });
        await expect(
          collect(
            runChain(
              deps.deps,
              chainOf(target("a", { errorHandlingMode: mode, maxRetries: 2 })),
              settings(),
              14,
              signal,
            ),
          ),
        ).resolves.toEqual(["recovered-a"]);
        expect(sent).toEqual(["a/m", "a/m", "a/m"]);
        expect(clock.sleeps.filter((ms) => ms < 60_000)).toEqual([1_000, 2_000]);
        expect(history).toHaveLength(0);
      }
    },
  );
  it("records one exhausted TTFT event and enters cooldown", async () => {
    const clock = new AdvancingClock();
    const sent: string[] = [];
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      clock,
      history,
      send: async (ref) => {
        sent.push(ref);
        return ref === "a/m"
          ? waitBeforeMeaningful("timed-out").attempt
          : successfulAttempt("from-b");
      },
    });
    await expect(
      collect(
        runChain(
          deps.deps,
          chainAB({ errorHandlingMode: "retry", maxRetries: 2 }),
          settings(),
          15,
          signal,
        ),
      ),
    ).resolves.toEqual(["from-b"]);
    expect(sent).toEqual(["a/m", "a/m", "a/m", "b/m"]);
    expect(clock.sleeps.filter((ms) => ms < 60_000)).toEqual([1_000, 2_000]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: "a/m", to: "b/m", reason: "ttft-timeout" });
    expect(deps.state.snapshot()["a/m"]?.cooldownLevel).toBe(1);
  });
  it("switch advances immediately after a TTFT failure", async () => {
    const clock = new AdvancingClock();
    const sent: string[] = [];
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      clock,
      history,
      send: async (ref) => {
        sent.push(ref);
        return ref === "a/m"
          ? waitBeforeMeaningful("timed-out").attempt
          : successfulAttempt("from-b");
      },
    });
    await expect(
      collect(
        runChain(
          deps.deps,
          chainAB({ errorHandlingMode: "switch", maxRetries: 8 }),
          settings(),
          16,
          signal,
        ),
      ),
    ).resolves.toEqual(["from-b"]);
    expect(sent).toEqual(["a/m", "b/m"]);
    expect(clock.sleeps.filter((ms) => ms < 60_000)).toEqual([]);
    expect(history).toHaveLength(1);
  });
  it("resets the retry budget after switching targets", async () => {
    const clock = new AdvancingClock();
    const sent: string[] = [];
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      clock,
      history,
      send: async (ref) => {
        sent.push(ref);
        return waitBeforeMeaningful("timed-out").attempt;
      },
    });
    const stream = collect(
      runChain(
        deps.deps,
        chainOf(
          target("a", { errorHandlingMode: "retry", maxRetries: 1 }),
          target("b", { errorHandlingMode: "retry", maxRetries: 1 }),
        ),
        settings(),
        18,
        signal,
      ),
    );
    await expect(stream).rejects.toMatchObject({ timer: "ttft" });
    expect(sent).toEqual(["a/m", "a/m", "b/m", "b/m"]);
    expect(clock.sleeps.filter((ms) => ms < 60_000)).toEqual([1_000, 1_000]);
    expect(history).toHaveLength(2);
    expect(history.map(({ from }) => from)).toEqual(["a/m", "b/m"]);
  });
  it("makes one cooldown-ignoring pass over all-excluded targets and honors Manual Recovery", async () => {
    const now = 0;
    const initialState: Record<TargetRef, TargetState> = {
      "a/m": applyFailure(reset(), "http-503", now),
      "b/m": applyFailure(reset(), "http-503", now),
      "c/m": applyManualRecovery(reset(), now, "persistent"),
    };
    const sent: string[] = [];
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      initialState,
      history,
      send: async (ref) => {
        sent.push(ref);
        return throwingAttempt({ status: 503 });
      },
    });
    await expect(
      collect(runChain(deps.deps, chainABC, settings(), 8, signal)),
    ).rejects.toMatchObject({ status: 503 });
    expect(sent).toEqual(["a/m", "b/m"]);
    expect(history).toHaveLength(2);
    expect(history.map(({ from, to }) => [from, to])).toEqual([
      ["a/m", "b/m"],
      ["b/m", "c/m"],
    ]);
  });
  it("switch never retries after a cooldown-class failure", async () => {
    const sent: string[] = [];
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      history,
      send: async (ref) => {
        sent.push(ref);
        return ref === "a/m" ? throwingAttempt({ status: 503 }) : successfulAttempt("from-b");
      },
    });
    await expect(
      collect(
        runChain(
          deps.deps,
          chainAB({ errorHandlingMode: "switch", maxRetries: 8 }),
          settings({ ttftTimeoutSeconds: 0, noProgressTimeoutSeconds: 0 }),
          9,
          new AbortController().signal,
        ),
      ),
    ).resolves.toEqual(["from-b"]);
    expect(sent).toEqual(["a/m", "b/m"]);
    expect(history).toHaveLength(1);
  });
  it("C15: compatibility retry strips one parameter without state or history", async () => {
    const stripped: string[][] = [];
    const settingsSeen: Settings[] = [];
    let sends = 0;
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      history,
      send: async (ref, targetSettings, parameters) => {
        expect(ref).toBe("a/m");
        settingsSeen.push(structuredClone(targetSettings) as Settings);
        stripped.push([...parameters]);
        sends++;
        return sends === 1
          ? throwingAttempt({
              status: 400,
              body: "Unknown parameter: temperature",
              sentParams: ["temperature"],
            })
          : successfulAttempt("from-a");
      },
    });
    await expect(
      collect(
        runChain(
          deps.deps,
          chainOf(
            target("a", { errorHandlingMode: "switch", modelParameters: { temperature: 0.8 } }),
          ),
          settings(),
          6,
          new AbortController().signal,
        ),
      ),
    ).resolves.toEqual(["from-a"]);
    expect(stripped).toEqual([[], ["temperature"]]);
    expect(settingsSeen[0]?.modelParameters).toEqual({ temperature: 0.8 });
    expect(history).toHaveLength(0);
  });
  it("smart retries network failures but switches on HTTP 5xx", async () => {
    const retried: string[] = [];
    const first = makeEngine({
      clock: new AdvancingClock(),
      send: async (ref) => {
        retried.push(ref);
        return retried.length === 1
          ? throwingAttempt({ code: "ECONNRESET" })
          : successfulAttempt("network-recovered");
      },
    });
    await expect(
      collect(
        runChain(first.deps, chainOf(target("a")), settings(), 11, new AbortController().signal),
      ),
    ).resolves.toEqual(["network-recovered"]);
    expect(retried).toEqual(["a/m", "a/m"]);
    expect(first.history).toHaveLength(0);
    const switched: string[] = [];
    const history: FailoverEvent[] = [];
    const second = makeEngine({
      history,
      send: async (ref) => {
        switched.push(ref);
        return ref === "a/m" ? throwingAttempt({ status: 503 }) : successfulAttempt("from-b");
      },
    });
    await expect(
      collect(runChain(second.deps, chainAB(), settings(), 12, new AbortController().signal)),
    ).resolves.toEqual(["from-b"]);
    expect(switched).toEqual(["a/m", "b/m"]);
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe("http-503");
  });
  it("parent cancellation aborts the current attempt without state or history failure", async () => {
    const clock = new ObservableClock();
    const first = pendingAttempt();
    const history: FailoverEvent[] = [];
    const controller = new AbortController();
    const deps = makeEngine({
      clock,
      history,
      send: async () => first.attempt,
    });
    const running = collect(
      runChain(deps.deps, chainOf(target("a")), settings(), 13, controller.signal),
    );
    await waitFor(() => clock.sleeps.includes(60_000));
    controller.abort();
    await expect(running).rejects.toThrow(/abort/i);
    expect(first.aborts()).toBe(1);
    expect(history).toHaveLength(0);
    expect(deps.state.updates).toBe(0);
  });
  it("records the physical next target even when it is excluded", async () => {
    const deps = makeEngine({
      initialState: { "b/m": applyFailure(reset(), "http-503", 0) },
      send: async () => throwingAttempt({ status: 503 }),
    });
    const stream = collect(runChain(deps.deps, chainABC, settings(), 23, signal));
    await expect(stream).rejects.toMatchObject({ status: 503 });
    expect(deps.history.map(({ from, to }) => [from, to])).toEqual([
      ["a/m", "b/m"],
      ["c/m", null],
    ]);
  });
  it("records a null next target only after the final physical target", async () => {
    const deps = makeEngine({ send: async () => throwingAttempt({ status: 503 }) });
    const stream = collect(runChain(deps.deps, chainOf(target("a")), settings(), 24, signal));
    await expect(stream).rejects.toMatchObject({ status: 503 });
    expect(deps.history[0]).toMatchObject({ from: "a/m", to: null });
  });
});
