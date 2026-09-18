import { describe, expect, it } from "vitest";
import { type Attempt, runChain } from "../../src/domain/engine.js";
import type { Clock } from "../../src/domain/ports.js";
import type { Chain, Settings, TargetRef, TargetState } from "../../src/domain/types.js";

const settings: Settings = {
  listRows: 7,
  errorHandlingMode: "switch",
  maxRetries: 0,
  reasoningEffort: "inherit",
  modelParameters: {},
  noProgressTimeoutSeconds: 90,
  ttftTimeoutSeconds: 60,
  serverQuality: { enabled: true, ttft: true, noProgress: true },
};
const chain: Chain = {
  id: "coding",
  name: "Coding Chain",
  targets: [{ provider: "relay", modelId: "m" }],
};
const clock: Clock = { now: () => 0, sleep: async () => {} };
const initialState: Record<TargetRef, TargetState> = {};

function timedOut(timer: "ttft" | "no-progress"): Attempt {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    events: (async function* () {
      if (timer === "no-progress") yield { meaningful: true, payload: "partial" };
      await pending;
    })(),
    abort: release,
  };
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe("runChain final failure metadata", () => {
  it.each([
    ["ttft" as const, "ttft-timeout" as const],
    ["no-progress" as const, "no-progress" as const],
  ])("includes the final target and %s reason", async (timer, reason) => {
    const deps = {
      send: async () => timedOut(timer),
      state: {
        read: async () => structuredClone(initialState),
        update: async () => {},
      },
      history: { append: async () => {} },
      clock,
      sessionId: "session-1",
    };

    await expect(
      collect(runChain(deps, chain, settings, 1, new AbortController().signal)),
    ).rejects.toMatchObject({ target: "relay/m", timer, reason });
  });
});
