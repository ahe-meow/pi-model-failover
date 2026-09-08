import { describe, expect, it } from "vitest";
import { WriteQueue } from "../../src/config/writeQueue.js";

describe("WriteQueue", () => {
  it("runs tasks in enqueue order", async () => {
    const q = new WriteQueue();
    const log: number[] = [];
    const slow = q.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      log.push(1);
    });
    const fast = q.enqueue(async () => {
      log.push(2);
    });

    await Promise.all([slow, fast]);
    expect(log).toEqual([1, 2]);
  });

  it("a rejected task rejects its caller and does not stop later tasks", async () => {
    const q = new WriteQueue();

    await expect(
      q.enqueue(async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(await q.enqueue(async () => 7)).toBe(7);
  });

  it("pending drops to 0", async () => {
    const q = new WriteQueue();
    const pending = q.enqueue(async () => 1);

    expect(q.pending()).toBe(1);
    await pending;
    expect(q.pending()).toBe(0);
  });
});
