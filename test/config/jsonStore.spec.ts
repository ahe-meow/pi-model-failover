import { describe, expect, it } from "vitest";
import { JsonStore } from "../../src/config/jsonStore.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { MemoryFs } from "../fakes/memoryFs.js";

type Doc = { version: number; a: number };

const make = (fs: MemoryFs, migrations: Record<number, (raw: unknown) => unknown> = {}) =>
  new JsonStore<Doc>(fs, new WriteQueue(), {
    path: "/d/x.json",
    version: 2,
    defaults: () => ({ version: 2, a: 1 }),
    migrations,
  });

describe("JsonStore", () => {
  it("missing file returns defaults", async () => {
    const result = await make(new MemoryFs()).load();

    expect(result).toEqual({ value: { version: 2, a: 1 }, status: "missing" });
  });

  it("corrupt file returns defaults and leaves file untouched", async () => {
    const fs = new MemoryFs();
    fs.files.set("/d/x.json", "{not json");

    const result = await make(fs).load();

    expect(result).toEqual({ value: { version: 2, a: 1 }, status: "corrupt" });
    expect(fs.files.get("/d/x.json")).toBe("{not json");
  });

  it("null root returns defaults, reports corrupt, and refuses to save", async () => {
    const fs = new MemoryFs();
    const original = "null";
    fs.files.set("/d/x.json", original);
    const store = make(fs);

    const result = await store.load();

    expect(result).toEqual({ value: { version: 2, a: 1 }, status: "corrupt" });
    await expect(store.save({ version: 2, a: 3 })).rejects.toThrow(/corrupt/);
    expect(fs.files.get("/d/x.json")).toBe(original);
  });

  it("newer version reports status and refuses to save", async () => {
    const fs = new MemoryFs();
    fs.files.set("/d/x.json", JSON.stringify({ version: 9, a: 5 }));
    const store = make(fs);

    const result = await store.load();

    expect(result).toEqual({ value: { version: 2, a: 1 }, status: "newer-version" });
    await expect(store.save({ version: 2, a: 3 })).rejects.toThrow(/newer/);
    expect(JSON.parse(fs.files.get("/d/x.json") ?? "null")).toEqual({ version: 9, a: 5 });
  });

  it("runs lower-version migrations in order", async () => {
    const fs = new MemoryFs();
    fs.files.set("/d/x.json", JSON.stringify({ version: 0, a: 1 }));
    const order: number[] = [];
    const store = make(fs, {
      0: (raw: unknown) => {
        order.push(0);
        return { ...(raw as Doc), version: 1, a: 2 };
      },
      1: (raw: unknown) => {
        order.push(1);
        return { ...(raw as Doc), version: 2, a: 10 };
      },
    });

    const result = await store.load();

    expect(order).toEqual([0, 1]);
    expect(result).toEqual({ value: { version: 2, a: 10 }, status: "migrated" });
  });

  it("saves with 0600 and preserves parsed unknown fields", async () => {
    const fs = new MemoryFs();
    fs.files.set("/d/x.json", JSON.stringify({ version: 2, a: 1, zzz: { keep: true } }));
    const store = make(fs);
    const loaded = await store.load();

    expect(loaded.status).toBe("ok");
    await store.save({ ...loaded.value, a: 2 });

    expect(fs.modes.get("/d/x.json")).toBe(0o600);
    expect(JSON.parse(fs.files.get("/d/x.json") ?? "null")).toEqual({
      version: 2,
      a: 2,
      zzz: { keep: true },
    });
  });
});
