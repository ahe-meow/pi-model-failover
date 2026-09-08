import type { Clock } from "../../src/domain/ports.js";

export class FakeClock implements Clock {
  private t = 0;
  private sleepers: Array<{ at: number; resolve: () => void }> = [];

  now() {
    return this.t;
  }

  sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      this.sleepers.push({ at: this.t + ms, resolve });
    });
  }

  advance(ms: number) {
    this.t += ms;
    const due = this.sleepers.filter((s) => s.at <= this.t);
    this.sleepers = this.sleepers.filter((s) => s.at > this.t);
    for (const s of due) s.resolve();
  }
}
