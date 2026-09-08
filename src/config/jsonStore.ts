import type { FileSystem } from "../domain/ports.js";
import type { WriteQueue } from "./writeQueue.js";

export type LoadStatus = "ok" | "missing" | "corrupt" | "newer-version" | "migrated";

export interface StoreOptions<T> {
  path: string;
  version: number;
  defaults: () => T;
  migrations: Record<number, (raw: unknown) => unknown>;
  mode?: number;
}

export class JsonStore<T extends { version: number }> {
  private frozen = false;

  constructor(
    private readonly fs: FileSystem,
    private readonly queue: WriteQueue,
    private readonly opts: StoreOptions<T>,
  ) {}

  async load(): Promise<{ value: T; status: LoadStatus }> {
    const text = await this.fs.readText(this.opts.path);
    if (text === null) {
      return { value: this.opts.defaults(), status: "missing" };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.frozen = true;
      return { value: this.opts.defaults(), status: "corrupt" };
    }

    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      this.frozen = true;
      return { value: this.opts.defaults(), status: "corrupt" };
    }

    const version = (raw as { version?: unknown }).version;
    if (typeof version !== "number") {
      this.frozen = true;
      return { value: this.opts.defaults(), status: "corrupt" };
    }
    if (version > this.opts.version) {
      this.frozen = true;
      return { value: this.opts.defaults(), status: "newer-version" };
    }

    let migrated = false;
    for (let from = version; from < this.opts.version; from++) {
      const migration = this.opts.migrations[from];
      if (!migration) {
        this.frozen = true;
        return { value: this.opts.defaults(), status: "corrupt" };
      }
      raw = migration(raw);
      migrated = true;
    }

    return { value: raw as T, status: migrated ? "migrated" : "ok" };
  }

  save(value: T): Promise<void> {
    if (this.frozen) {
      return Promise.reject(
        new Error(`refusing to overwrite ${this.opts.path}: newer or corrupt file`),
      );
    }

    return this.queue.enqueue(() =>
      this.fs.writeAtomic(
        this.opts.path,
        `${JSON.stringify(value, null, 2)}\n`,
        this.opts.mode ?? 0o600,
      ),
    );
  }
}
