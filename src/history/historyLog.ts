import type { WriteQueue } from "../config/writeQueue.js";
import type { FileSystem } from "../domain/ports.js";
import { redactFailureBody } from "../domain/redact.js";
import type { FailoverErrorDetails, FailoverEvent, TargetRef } from "../domain/types.js";

const DEFAULT_CAP = 500;
const FIXED_REASONS = new Set(["network", "ttft-timeout", "no-progress", "persistent", "manual"]);

function isTargetRef(value: unknown): value is TargetRef {
  if (typeof value !== "string") return false;
  const slash = value.indexOf("/");
  return slash > 0 && slash < value.length - 1;
}

function isFailoverReason(value: unknown): value is FailoverEvent["reason"] {
  return typeof value === "string" && (FIXED_REASONS.has(value) || /^http-\d+$/.test(value));
}

function isFailoverEvent(value: unknown): value is FailoverEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.ts === "string" &&
    typeof event.sessionId === "string" &&
    typeof event.requestSeq === "number" &&
    Number.isInteger(event.requestSeq) &&
    event.requestSeq >= 0 &&
    isTargetRef(event.from) &&
    (event.to === null || isTargetRef(event.to)) &&
    isFailoverReason(event.reason) &&
    typeof event.elapsedMs === "number" &&
    Number.isFinite(event.elapsedMs) &&
    event.elapsedMs >= 0
  );
}

function errorDetails(value: unknown): FailoverErrorDetails | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const details: FailoverErrorDetails = {};
  if (typeof record.status === "number" && Number.isFinite(record.status)) {
    details.status = record.status;
  }
  if (typeof record.code === "string") details.code = record.code;
  if (typeof record.body === "string") details.body = redactFailureBody(record.body);
  return Object.keys(details).length === 0 ? undefined : details;
}

type EventWithOptionalError = FailoverEvent & { error?: unknown };

function redactEvent(event: EventWithOptionalError): EventWithOptionalError {
  const { error: rawError, ...rest } = event;
  const details = errorDetails(rawError);
  return details === undefined ? rest : { ...rest, error: details };
}

function providerOf(ref: TargetRef): string {
  return ref.slice(0, ref.indexOf("/"));
}

export class HistoryLog {
  private readonly path: string;
  private readonly cap: number;
  private lastWrite: Promise<void> = Promise.resolve();

  private constructor(
    private readonly fs: FileSystem,
    private readonly queue: WriteQueue,
    dir: string,
    cap: number,
  ) {
    this.path = `${dir}/history.jsonl`;
    this.cap = cap;
  }

  static async open(
    fs: FileSystem,
    queue: WriteQueue,
    dir: string,
    cap = DEFAULT_CAP,
  ): Promise<HistoryLog> {
    await fs.mkdir(dir, 0o700);
    return new HistoryLog(fs, queue, dir, cap);
  }

  append(event: FailoverEvent): Promise<void> {
    const write = this.queue.enqueue(async () => {
      const { events } = await this.readEvents();
      events.push(redactEvent(event));
      const retained = this.cap === 0 ? [] : events.slice(-this.cap);
      const text = retained.map((entry) => JSON.stringify(entry)).join("\n");
      await this.fs.writeAtomic(this.path, text === "" ? "" : `${text}\n`, 0o600);
    });
    this.lastWrite = write;
    return write;
  }

  async list(filter?: { provider?: string }): Promise<{
    events: FailoverEvent[];
    dropped: number;
  }> {
    const { events, dropped } = await this.readEvents();
    const newest = events.reverse();
    const provider = filter?.provider;
    if (provider === undefined) return { events: newest, dropped };
    return {
      events: newest.filter(
        (event) =>
          providerOf(event.from) === provider ||
          (event.to !== null && providerOf(event.to) === provider),
      ),
      dropped,
    };
  }

  async flush(): Promise<void> {
    await this.lastWrite;
  }

  private async readEvents(): Promise<{ events: FailoverEvent[]; dropped: number }> {
    const text = await this.fs.readText(this.path);
    if (text === null) return { events: [], dropped: 0 };

    const events: FailoverEvent[] = [];
    let dropped = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const value: unknown = JSON.parse(line);
        if (!isFailoverEvent(value)) {
          dropped++;
          continue;
        }
        events.push(redactEvent(value));
      } catch {
        dropped++;
      }
    }
    return { events, dropped };
  }
}
