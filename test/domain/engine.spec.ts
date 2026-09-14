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
  ttftAction: "cooldown-only",
  ...overrides,
});
const target = (provider: string, overrides: Partial<Target> = {}): Target => ({
  provider,
  modelId: "m",
  ...overrides,
});
const chainOf = (...targets: Target[]): Chain => ({ id: "coding", name: "Coding", targets });
const chainAB = (a: Partial<Target> = {}, b: Partial<Target> = {}): Chain =>
  chainOf(target("a", a), target("b", b));
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
function waitBeforeMeaningful(payload: unknown): ControlledAttempt {
  const gate = deferred();
  let abortCount = 0;
  return {
    attempt: {
      events: (async function* () {
        await gate.promise;
        yield { meaningful: true, payload };
        yield { meaningful: false, payload: "done", done: true };
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
function waitAfterNonmeaningful(payload: unknown): ControlledAttempt {
  const gate = deferred();
  let abortCount = 0;
  return {
    attempt: {
      events: (async function* () {
        yield { meaningful: false, payload };
        await gate.promise;
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
function waitAfterMeaningful(payload: unknown): ControlledAttempt {
  const gate = deferred();
  let abortCount = 0;
  return {
    attempt: {
      events: (async function* () {
        yield { meaningful: true, payload };
        await gate.promise;
        yield { meaningful: false, payload: "done", done: true };
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
function pendingAttempt(): ControlledAttempt {
  const gate = deferred();
  let abortCount = 0;
  return {
    attempt: {
      events: (async function* () {
        yield* [] as StreamChunk[];
        await gate.promise;
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
    expect(history[0]).toMatchObject({ from: "a/m", to: "b/m", reason: "persistent" });
    expect(deps.state.snapshot()["a/m"]?.manualRecovery).toBe(true);
  });
  it("C10: cooldown-only TTFT lets A finish and cools it for the next request", async () => {
    const clock = new ObservableClock();
    const first = waitBeforeMeaningful("from-a");
    const history: FailoverEvent[] = [];
    const sent: string[] = [];
    const deps = makeEngine({
      clock,
      history,
      send: async (ref) => {
        sent.push(ref);
        return ref === "a/m" ? first.attempt : successfulAttempt("from-b");
      },
    });
    const running = collect(
      runChain(deps.deps, chainAB(), settings(), 3, new AbortController().signal),
    );
    await waitFor(() => clock.sleeps.includes(60_000));
    clock.advance(60_000);
    first.release();

    await expect(running).resolves.toEqual(["from-a", "done"]);
    expect(sent).toEqual(["a/m"]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: "a/m", to: null, reason: "ttft-timeout" });
    expect(deps.state.snapshot()["a/m"]?.cooldownUntil).toBe(new Date(120_000).toISOString());
  });
  it("C11: abort TTFT discards A partial output and B wins in the same request", async () => {
    const clock = new ObservableClock();
    const first = waitAfterNonmeaningful("partial-from-a");
    const sent: string[] = [];
    const history: FailoverEvent[] = [];
    const deps = makeEngine({
      clock,
      history,
      send: async (ref) => {
        sent.push(ref);
        return ref === "a/m" ? first.attempt : successfulAttempt("from-b");
      },
    });
    const running = collect(
      runChain(
        deps.deps,
        chainAB({ ttftAction: "abort" }),
        settings(),
        4,
        new AbortController().signal,
      ),
    );
    await waitFor(() => clock.sleeps.includes(60_000));
    clock.advance(60_000);

    await expect(running).resolves.toEqual(["from-b"]);
    expect(first.aborts()).toBe(1);
    expect(sent).toEqual(["a/m", "b/m"]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: "a/m", to: "b/m", reason: "ttft-timeout" });
  });
  it("C12: no-progress aborts after the first meaningful delta", async () => {
    const clock = new ObservableClock();
    const first = waitAfterMeaningful("partial-from-a");
    const history: FailoverEvent[] = [];
    const sent: string[] = [];
    const deps = makeEngine({
      clock,
      history,
      send: async (ref) => {
        sent.push(ref);
        return ref === "a/m" ? first.attempt : successfulAttempt("from-b");
      },
    });
    const running = collect(
      runChain(deps.deps, chainAB(), settings(), 5, new AbortController().signal),
    );
    await waitFor(() => clock.sleeps.filter((ms) => ms === 90_000).length === 1);
    clock.advance(90_000);

    await expect(running).resolves.toEqual(["from-b"]);
    expect(first.aborts()).toBe(1);
    expect(sent).toEqual(["a/m", "b/m"]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: "a/m", to: "b/m", reason: "no-progress" });
  });

  it("retry mode advances after timer failure without backoff", async () => {
    for (const [first, targetOptions, reason] of [
      [
        waitAfterNonmeaningful("partial-from-a"),
        { ttftAction: "abort" as const },
        "ttft-timeout" as const,
      ],
      [
        waitAfterMeaningful("partial-from-a"),
        { ttftTimeoutSeconds: 0, ttftAction: "abort" as const },
        "no-progress" as const,
      ],
    ] as const) {
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
          return aAttempts++ === 0 ? first.attempt : successfulAttempt("wrong-a");
        },
      });
      await expect(
        collect(
          runChain(
            deps.deps,
            chainAB({ ...targetOptions, errorHandlingMode: "retry", maxRetries: 1 }),
            settings(),
            14,
            new AbortController().signal,
          ),
        ),
      ).resolves.toEqual(["from-b"]);
      expect(sent).toEqual(["a/m", "b/m"]);
      expect(clock.sleeps).not.toContain(1_000);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ from: "a/m", to: "b/m", reason });
    }
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
      collect(
        runChain(
          deps.deps,
          chainOf(target("a"), target("b"), target("c")),
          settings(),
          8,
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(sent).toEqual(["a/m", "b/m"]);
    expect(history).toHaveLength(2);
    expect(history.map(({ from, to }) => [from, to])).toEqual([
      ["a/m", "b/m"],
      ["b/m", null],
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
  it("retry sleeps with capped backoff and records one event after retries are exhausted", async () => {
    const clock = new AdvancingClock();
    const sent: string[] = [];
    const history: FailoverEvent[] = [];
    let failures = 0;
    const deps = makeEngine({
      clock,
      history,
      send: async (ref) => {
        sent.push(ref);
        if (ref === "a/m" && failures++ < 13) return throwingAttempt({ status: 503 });
        return successfulAttempt("from-b");
      },
    });

    await expect(
      collect(
        runChain(
          deps.deps,
          chainAB({ errorHandlingMode: "retry", maxRetries: 12 }),
          settings({ ttftTimeoutSeconds: 0, noProgressTimeoutSeconds: 0 }),
          10,
          new AbortController().signal,
        ),
      ),
    ).resolves.toEqual(["from-b"]);
    expect(sent).toEqual([...Array.from({ length: 13 }, () => "a/m"), "b/m"]);
    expect(clock.sleeps).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000,
    ]);
    expect(history).toHaveLength(1);
    expect(deps.state.updates).toBe(2);
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
});
