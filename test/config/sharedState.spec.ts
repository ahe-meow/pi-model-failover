import { describe, expect, it, vi } from "vitest";
import { SharedState } from "../../src/config/sharedState.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { FakeClock } from "../fakes/fakeClock.js";
import { MemoryFs } from "../fakes/memoryFs.js";

const state = {
  consecutiveFailures: 1,
  cooldownLevel: 1,
  cooldownUntil: null,
  manualRecovery: false,
  lastFailure: null,
};

class AdvancingClock extends FakeClock {
  readonly sleeps: number[] = [];

  override async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("aborted");
    this.sleeps.push(ms);
    this.advance(ms);
  }
}

class ReleaseLockFs extends MemoryFs {
  attempts = 0;

  constructor(private readonly releaseAt: number) {
    super();
  }

  override async tryCreateExclusive(path: string): Promise<boolean> {
    this.attempts++;
    if (this.attempts === this.releaseAt) {
      this.files.delete(path);
      this.mtimes.delete(path);
    }
    return super.tryCreateExclusive(path);
  }
}

class CountingFs extends MemoryFs {
  writes = 0;

  override async writeAtomic(path: string, data: string, mode: number): Promise<void> {
    this.writes++;
    await super.writeAtomic(path, data, mode);
  }
}

class DeferredWriteFs extends MemoryFs {
  private readonly writeGate: Promise<void>;
  private releaseWrite!: () => void;
  private resolveStarted!: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  constructor() {
    super();
    this.writeGate = new Promise<void>((resolve) => {
      this.releaseWrite = resolve;
    });
  }

  release(): void {
    this.releaseWrite();
  }

  override async writeAtomic(path: string, data: string, mode: number): Promise<void> {
    this.resolveStarted();
    await this.writeGate;
    await super.writeAtomic(path, data, mode);
  }
}

describe("SharedState", () => {
  it("C14: writes revision and a later instance sees another process update", async () => {
    const fs = new MemoryFs();
    const first = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d");
    await first.update((targets) => {
      targets["relay/m"] = state;
    });
    const other = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d");
    await other.update((targets) => {
      targets["other/m"] = state;
    });

    expect(Object.keys(await first.read()).sort()).toEqual(["other/m", "relay/m"]);
    expect(JSON.parse(fs.files.get("/d/state.json") ?? "{}").revision).toBe(2);
  });

  it("releases state.lock after a successful update", async () => {
    const fs = new MemoryFs();
    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d");

    await store.update(() => {});

    expect(fs.files.has("/d/state.lock")).toBe(false);
  });

  it("releases state.lock when the update callback fails", async () => {
    const fs = new MemoryFs();
    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d");

    await expect(
      store.update(() => {
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");

    expect(fs.files.has("/d/state.lock")).toBe(false);
  });

  it("replaces a stale lock", async () => {
    const clock = new FakeClock();
    const fs = new MemoryFs();
    fs.files.set("/d/state.lock", "");
    fs.mtimes.set("/d/state.lock", -20_000);
    const store = await SharedState.open(fs, clock, new WriteQueue(), "/d");

    await store.update(() => {});

    expect(fs.files.has("/d/state.lock")).toBe(false);
  });

  it("retries a fresh lock every 50 ms until it becomes available", async () => {
    const clock = new AdvancingClock();
    const fs = new ReleaseLockFs(3);
    fs.files.set("/d/state.lock", "");
    fs.mtimes.set("/d/state.lock", clock.now());
    const store = await SharedState.open(fs, clock, new WriteQueue(), "/d");

    await store.update(() => {});

    expect(clock.sleeps).toEqual([50, 50]);
    expect(fs.files.has("/d/state.lock")).toBe(false);
  });

  it("stops lock retries after two seconds", async () => {
    const clock = new AdvancingClock();
    const fs = new MemoryFs();
    fs.files.set("/d/state.lock", "");
    fs.mtimes.set("/d/state.lock", clock.now());
    const store = await SharedState.open(fs, clock, new WriteQueue(), "/d");

    await expect(store.update(() => {})).rejects.toThrow(/lock/);

    expect(clock.sleeps).toHaveLength(40);
    expect(clock.sleeps.every((ms) => ms === 50)).toBe(true);
    expect(fs.files.has("/d/state.lock")).toBe(true);
  });

  it("C21: creates the directory with 0700 and writes state atomically with 0600", async () => {
    const fs = new MemoryFs();
    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d");

    expect(fs.modes.get("/d")).toBe(0o700);
    await store.update(() => {});

    expect(fs.modes.get("/d/state.json")).toBe(0o600);
    expect(fs.files.has("/d/state.json")).toBe(true);
  });

  it("preserves unknown top-level fields when writing a valid document", async () => {
    const fs = new MemoryFs();
    fs.files.set(
      "/d/state.json",
      JSON.stringify({
        version: 1,
        revision: 7,
        targets: { "relay/m": state },
        futureField: { enabled: true },
        futureList: ["keep", 3],
      }),
    );
    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d");

    await store.update((targets) => {
      targets["other/m"] = state;
    });

    expect(JSON.parse(fs.files.get("/d/state.json") ?? "null")).toEqual({
      version: 1,
      revision: 8,
      targets: { "relay/m": state, "other/m": state },
      futureField: { enabled: true },
      futureList: ["keep", 3],
    });
  });

  it("reads a fresh disk snapshot and returns an independent copy", async () => {
    const fs = new MemoryFs();
    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d");
    await store.update((targets) => {
      targets["relay/m"] = state;
    });
    fs.files.set(
      "/d/state.json",
      JSON.stringify({
        version: 1,
        revision: 9,
        targets: { "external/m": state },
      }),
    );

    const snapshot = await store.read();
    const external = snapshot["external/m"];
    if (external === undefined) throw new Error("missing external state");
    external.consecutiveFailures = 99;

    expect(external.consecutiveFailures).toBe(99);
    expect(await store.read()).toEqual({ "external/m": state });
  });

  it("serializes concurrent updates through the supplied WriteQueue", async () => {
    const fs = new MemoryFs();
    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d");

    await Promise.all([
      store.update((targets) => {
        targets["first/m"] = state;
      }),
      store.update((targets) => {
        targets["second/m"] = state;
      }),
    ]);

    expect(JSON.parse(fs.files.get("/d/state.json") ?? "null")).toMatchObject({
      revision: 2,
      targets: { "first/m": state, "second/m": state },
    });
  });

  it("flush waits for the last queued write and does not force an idle write", async () => {
    const fs = new DeferredWriteFs();
    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d");

    await store.flush();
    expect(fs.files.has("/d/state.json")).toBe(false);

    const update = store.update((targets) => {
      targets["relay/m"] = state;
    });
    await fs.started;
    let flushed = false;
    const waiting = store.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    fs.release();
    await update;
    await waiting;
    expect(flushed).toBe(true);
  });

  it("C23: corrupt state enters memory mode, notifies once, and leaves bytes untouched", async () => {
    const fs = new CountingFs();
    const original = "{not-json";
    fs.files.set("/d/state.json", original);
    const notify = vi.fn();
    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d", notify);

    expect(store.isMemoryMode()).toBe(true);
    await store.update((targets) => {
      targets["relay/m"] = state;
    });
    await store.update(() => {});
    expect(notify).toHaveBeenCalledTimes(1);
    expect(fs.files.get("/d/state.json")).toBe(original);
    expect(fs.writes).toBe(0);
    expect((await store.read())["relay/m"]).toEqual(state);
  });

  it("C23: a newer state version enters memory mode without exposing source bytes", async () => {
    const fs = new CountingFs();
    const original = JSON.stringify({
      version: 2,
      revision: 3,
      targets: {},
      credential: "sk-live-secret",
    });
    fs.files.set("/d/state.json", original);
    const notify = vi.fn();
    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d", notify);

    expect(store.isMemoryMode()).toBe(true);
    await store.update((targets) => {
      targets["relay/m"] = state;
    });
    await store.read();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("sk-live-secret"));
    expect(fs.files.get("/d/state.json")).toBe(original);
    expect(fs.writes).toBe(0);
    expect((await store.read())["relay/m"]).toEqual(state);
  });

  it("treats a semantically invalid failure reason as corruption and preserves source bytes", async () => {
    const fs = new CountingFs();
    const original = JSON.stringify({
      version: 1,
      revision: 1,
      targets: {
        "relay/m": {
          ...state,
          lastFailure: { ts: "2026-09-12T12:00:00.000Z", reason: "provider-broke" },
        },
      },
    });
    fs.files.set("/d/state.json", original);
    const notify = vi.fn();

    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d", notify);

    expect(store.isMemoryMode()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(fs.files.get("/d/state.json")).toBe(original);
    expect(fs.writes).toBe(0);
  });

  it("treats an invalid state shape as corruption and keeps the source untouched", async () => {
    const fs = new MemoryFs();
    const original = JSON.stringify({ version: 1, revision: 1, targets: [] });
    fs.files.set("/d/state.json", original);
    const notify = vi.fn();

    const store = await SharedState.open(fs, new FakeClock(), new WriteQueue(), "/d", notify);

    expect(store.isMemoryMode()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(fs.files.get("/d/state.json")).toBe(original);
  });
});
