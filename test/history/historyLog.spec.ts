import { describe, expect, it, vi } from "vitest";
import { WriteQueue } from "../../src/config/writeQueue.js";
import type { FailoverEvent } from "../../src/domain/types.js";
import { HistoryLog } from "../../src/history/historyLog.js";
import { MemoryFs } from "../fakes/memoryFs.js";

const event = (
  n: number,
  from: FailoverEvent["from"] = "a/m",
  to: FailoverEvent["to"] = "b/m",
): FailoverEvent => ({
  ts: new Date(n).toISOString(),
  sessionId: "s",
  requestSeq: n,
  from,
  to,
  reason: "http-503",
  elapsedMs: n,
});

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

describe("HistoryLog", () => {
  it("C17: keeps newest entries first when listing and caps appends", async () => {
    const fs = new MemoryFs();
    const log = await HistoryLog.open(fs, new WriteQueue(), "/d", 2);

    await log.append(event(1));
    await log.append(event(2));
    await log.append(event(3));

    await expect(log.list()).resolves.toEqual({
      events: [event(3), event(2)],
      dropped: 0,
    });
    expect(fs.modes.get("/d/history.jsonl")).toBe(0o600);
  });

  it("C17: reports malformed lines without rewriting them during list", async () => {
    const fs = new MemoryFs();
    const original = `${JSON.stringify(event(1))}\n{bad}\n`;
    fs.files.set("/d/history.jsonl", original);
    const write = vi.spyOn(fs, "writeAtomic");
    const log = await HistoryLog.open(fs, new WriteQueue(), "/d");

    await expect(log.list()).resolves.toEqual({ events: [event(1)], dropped: 1 });
    expect(write).not.toHaveBeenCalled();
    expect(fs.files.get("/d/history.jsonl")).toBe(original);
  });

  it("C17: drops JSON values that are not valid FailoverEvents", async () => {
    const fs = new MemoryFs();
    const valid = JSON.stringify(event(1));
    const invalid = JSON.stringify({ ...event(2), reason: "provider-broke" });
    fs.files.set("/d/history.jsonl", `${valid}\n${invalid}\n`);
    const log = await HistoryLog.open(fs, new WriteQueue(), "/d");

    await expect(log.list()).resolves.toEqual({ events: [event(1)], dropped: 1 });
  });

  it("C18: filters by provider at either event endpoint", async () => {
    const fs = new MemoryFs();
    const log = await HistoryLog.open(fs, new WriteQueue(), "/d");
    const fromProvider = event(2, "b/m", null);
    const unrelated = event(3, "c/m", "d/m");

    await log.append(event(1));
    await log.append(fromProvider);
    await log.append(unrelated);

    await expect(log.list({ provider: "b" })).resolves.toEqual({
      events: [fromProvider, event(1)],
      dropped: 0,
    });
  });

  it("C17: uses a default cap of 500 entries", async () => {
    const fs = new MemoryFs();
    const existing = Array.from({ length: 500 }, (_, index) => event(index));
    fs.files.set(
      "/d/history.jsonl",
      `${existing.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );
    const log = await HistoryLog.open(fs, new WriteQueue(), "/d");

    await log.append(event(500));

    const lines = (fs.files.get("/d/history.jsonl") ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(500);
    expect(JSON.parse(lines[0] ?? "null")).toEqual(event(1));
    expect(JSON.parse(lines.at(-1) ?? "null")).toEqual(event(500));
  });

  it("C17: removes malformed lines when appending and rewrites a final newline", async () => {
    const fs = new MemoryFs();
    fs.files.set("/d/history.jsonl", `${JSON.stringify(event(1))}\n{bad}\n`);
    const log = await HistoryLog.open(fs, new WriteQueue(), "/d");

    await log.append(event(2));

    expect(fs.files.get("/d/history.jsonl")).toBe(
      `${JSON.stringify(event(1))}\n${JSON.stringify(event(2))}\n`,
    );
  });

  it("serializes concurrent appends through the shared queue", async () => {
    const fs = new MemoryFs();
    const queue = new WriteQueue();
    const enqueue = vi.spyOn(queue, "enqueue");
    const write = vi.spyOn(fs, "writeAtomic");
    const log = await HistoryLog.open(fs, queue, "/d");

    await Promise.all([log.append(event(1)), log.append(event(2))]);

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
    await expect(log.list()).resolves.toEqual({
      events: [event(2), event(1)],
      dropped: 0,
    });
  });

  it("flush waits for an in-flight append and does not write while idle", async () => {
    const fs = new DeferredWriteFs();
    const write = vi.spyOn(fs, "writeAtomic");
    const log = await HistoryLog.open(fs, new WriteQueue(), "/d");

    await log.flush();
    expect(write).not.toHaveBeenCalled();

    const append = log.append(event(1));
    await fs.started;
    let flushed = false;
    const flush = log.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    fs.release();
    await append;
    await flush;
    expect(flushed).toBe(true);
  });
});
