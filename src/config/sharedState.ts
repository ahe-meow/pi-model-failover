import type { Clock, FileSystem } from "../domain/ports.js";
import type { FailoverReason, TargetRef, TargetState } from "../domain/types.js";
import { S } from "../strings.js";
import type { WriteQueue } from "./writeQueue.js";

const STATE_VERSION = 1;
const RETRY_MS = 50;
const LOCK_WAIT_MS = 2_000;
const STALE_LOCK_MS = 10_000;
const FIXED_FAILOVER_REASONS = new Set([
  "network",
  "ttft-timeout",
  "no-progress",
  "persistent",
  "manual",
]);

type StateDocument = {
  version: 1;
  revision: number;
  targets: Record<TargetRef, TargetState>;
  [key: string]: unknown;
};

type DiskState =
  | { kind: "missing" }
  | { kind: "corrupt" }
  | { kind: "newer-version" }
  | { kind: "valid"; document: StateDocument };

const clone = <T>(value: T): T => structuredClone(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFailoverReason(value: unknown): value is FailoverReason {
  return (
    typeof value === "string" && (FIXED_FAILOVER_REASONS.has(value) || /^http-\d+$/.test(value))
  );
}

function isTargetState(value: unknown): value is TargetState {
  if (!isRecord(value)) return false;
  if (
    typeof value.consecutiveFailures !== "number" ||
    !Number.isInteger(value.consecutiveFailures) ||
    value.consecutiveFailures < 0 ||
    typeof value.cooldownLevel !== "number" ||
    !Number.isInteger(value.cooldownLevel) ||
    value.cooldownLevel < 0 ||
    (value.cooldownUntil !== null && typeof value.cooldownUntil !== "string") ||
    typeof value.manualRecovery !== "boolean"
  ) {
    return false;
  }

  if (value.lastFailure === null) return true;
  return (
    isRecord(value.lastFailure) &&
    typeof value.lastFailure.ts === "string" &&
    isFailoverReason(value.lastFailure.reason)
  );
}

function parseState(text: string): DiskState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "corrupt" };
  }

  if (!isRecord(raw)) return { kind: "corrupt" };
  if (raw.version === undefined || typeof raw.version !== "number") {
    return { kind: "corrupt" };
  }
  if (raw.version > STATE_VERSION) return { kind: "newer-version" };
  if (
    raw.version !== STATE_VERSION ||
    typeof raw.revision !== "number" ||
    !Number.isInteger(raw.revision) ||
    raw.revision < 0 ||
    !isRecord(raw.targets)
  ) {
    return { kind: "corrupt" };
  }
  if (Object.values(raw.targets).some((target) => !isTargetState(target))) {
    return { kind: "corrupt" };
  }

  return { kind: "valid", document: raw as StateDocument };
}

export class SharedState {
  private readonly statePath: string;
  private readonly lockPath: string;
  private memoryMode = false;
  private notified = false;
  private targets: Record<TargetRef, TargetState> = {};
  private lastWrite: Promise<void> = Promise.resolve();

  private constructor(
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly queue: WriteQueue,
    dir: string,
    private readonly notify?: (message: string) => void,
  ) {
    this.statePath = `${dir}/state.json`;
    this.lockPath = `${dir}/state.lock`;
  }

  static async open(
    fs: FileSystem,
    clock: Clock,
    queue: WriteQueue,
    dir: string,
    notify?: (message: string) => void,
  ): Promise<SharedState> {
    await fs.mkdir(dir, 0o700);
    const store = new SharedState(fs, clock, queue, dir, notify);
    await store.load();
    return store;
  }

  async read(): Promise<Record<TargetRef, TargetState>> {
    if (this.memoryMode) return clone(this.targets);

    const state = await this.readDisk();
    if (state.kind === "missing") {
      this.setDocument({ version: STATE_VERSION, revision: 0, targets: {} });
    } else if (state.kind === "valid") {
      this.setDocument(state.document);
    } else {
      this.enterMemoryMode(state.kind);
    }
    return clone(this.targets);
  }

  update(fn: (targets: Record<TargetRef, TargetState>) => void): Promise<void> {
    const write = this.queue.enqueue(() => this.performUpdate(fn));
    this.lastWrite = write;
    return write;
  }

  isMemoryMode(): boolean {
    return this.memoryMode;
  }

  async flush(): Promise<void> {
    await this.lastWrite;
  }

  private async load(): Promise<void> {
    const state = await this.readDisk();
    if (state.kind === "missing") {
      this.setDocument({ version: STATE_VERSION, revision: 0, targets: {} });
    } else if (state.kind === "valid") {
      this.setDocument(state.document);
    } else {
      this.enterMemoryMode(state.kind);
    }
  }

  private async performUpdate(
    fn: (targets: Record<TargetRef, TargetState>) => void,
  ): Promise<void> {
    if (this.memoryMode) {
      this.updateMemory(fn);
      return;
    }

    await this.acquireLock();
    try {
      const state = await this.readDisk();
      if (state.kind === "missing") {
        const document: StateDocument = { version: STATE_VERSION, revision: 0, targets: {} };
        await this.writeDocument(document, fn);
      } else if (state.kind === "valid") {
        await this.writeDocument(state.document, fn);
      } else {
        this.enterMemoryMode(state.kind);
        this.updateMemory(fn);
      }
    } finally {
      await this.fs.unlink(this.lockPath);
    }
  }

  private async writeDocument(
    base: StateDocument,
    fn: (targets: Record<TargetRef, TargetState>) => void,
  ): Promise<void> {
    const nextTargets = clone(base.targets);
    fn(nextTargets);
    const next: StateDocument = {
      ...clone(base),
      version: STATE_VERSION,
      revision: base.revision + 1,
      targets: nextTargets,
    };
    await this.fs.writeAtomic(this.statePath, `${JSON.stringify(next, null, 2)}\n`, 0o600);
    this.setDocument(next);
  }

  private updateMemory(fn: (targets: Record<TargetRef, TargetState>) => void): void {
    const next = clone(this.targets);
    fn(next);
    this.targets = clone(next);
  }

  private async readDisk(): Promise<DiskState> {
    const text = await this.fs.readText(this.statePath);
    return text === null ? { kind: "missing" } : parseState(text);
  }

  private setDocument(document: StateDocument): void {
    this.targets = clone(document.targets);
  }

  private enterMemoryMode(reason: "corrupt" | "newer-version"): void {
    this.memoryMode = true;
    if (this.notified) return;
    this.notified = true;
    const message = reason === "newer-version" ? S.sharedState.newerVersion : S.sharedState.invalid;
    try {
      this.notify?.(message);
    } catch {
      // Notifications must not prevent fail-open state access.
    }
  }

  private async acquireLock(): Promise<void> {
    let waited = 0;
    while (true) {
      if (await this.fs.tryCreateExclusive(this.lockPath)) return;

      const mtime = await this.fs.mtime(this.lockPath);
      if (mtime !== null && this.clock.now() - mtime > STALE_LOCK_MS) {
        await this.fs.unlink(this.lockPath);
        continue;
      }
      if (waited >= LOCK_WAIT_MS) {
        throw new Error("timed out acquiring state lock");
      }
      const delay = Math.min(RETRY_MS, LOCK_WAIT_MS - waited);
      await this.clock.sleep(delay);
      waited += delay;
    }
  }
}
