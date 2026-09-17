# pi-model-failover P0 Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the package skeleton, the versioned config store, and the tabbed TUI frame (tabs, list height, scrollbar, key hints, help overlay, complete Settings tab) so P1–P3 only add domain and adapter modules.

**Architecture:** Four layers that import downward only (`tui` → `domain`/`config`; `adapters` → `domain`/`config`). File access, clock, and Pi APIs enter through injected ports so every unit test runs on in-memory fakes. `src/index.ts` is wiring only.

**Tech Stack:** TypeScript (ESM, no build step), vitest, Biome, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`.

**Spec:** `docs/design/00-goal.md` through `06-roadmap.md`, `CONTEXT.md`, `docs/adr/0001`–`0005`.

> **Historical plan notice:** This P0 execution plan is completed and superseded; do not treat its task steps or pre-v2 examples as the current implementation contract. Use `docs/design/00-goal.md` through `06-roadmap.md` and the current `src/` implementation instead. The v2 contract uses global `serverQuality: { enabled, ttft, noProgress }`, optional Target `inherit`/`on`/`off` overrides, request-start policy snapshots, `server-quality` timer classification, a shared retry budget/backoff, and cooldown/history only after retry exhaustion.

## Global Constraints

- Node `>=20`; `"type": "module"`; `main` is `./src/index.ts` (Pi loads TypeScript source).
- Every source module ≤ 400 lines; every test file ≤ 600 lines.
- Every user-visible string lives in `src/strings.ts` as a property of `S`.
- Files under `~/.pi/agent/pi-model-failover/` are created with mode `0600`, directory `0700`, atomic tmp+rename.
- Unknown JSON fields survive load and save.
- No code from branch `V1` or from `pi-model-manager`.
- Repo path contains spaces: quote it; git needs `git -c safe.directory='/storage/emulated/0/AI Workplace/pi-model-auto-switch'`. Commits are the parent's action; workers stop at the commit step and report.
- `listRows` range 5–20, default 7. Header, tab bar, list header, separator, and 1–2 hint lines are fixed.
- Key names: `Key` from `@earendil-works/pi-tui` is assumed to export `up, down, left, right, tab, shiftTab, enter, escape, pageUp, pageDown, home, end`. Task 6 Step 1 checks the real names; if they differ, use the real ones in every later task.

---

### Task 1: Package skeleton and test fakes

**Files:**

- Create: `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `LICENSE`
- Modify: `.gitignore` (append)
- Create: `src/domain/types.ts`, `src/domain/ports.ts`
- Create: `test/fakes/memoryFs.ts`, `test/fakes/fakeClock.ts`
- Test: `test/fakes/memoryFs.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `FileSystem`, `Clock` (from `src/domain/ports.ts`, exact shape in `03-components.md`), `MemoryFs implements FileSystem` with `modes: Map<string, number>` and `files: Map<string, string>`, `FakeClock implements Clock` with `advance(ms: number)`.

- [ ] **Step 1: Write config files**

Copy `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts` verbatim from `docs/design/05-skeleton-and-layout.md`. Write `LICENSE` with the MIT text and the copyright line `Copyright (c) 2025 pi-model-failover contributors`. Append the `.gitignore` lines from the same doc.

- [ ] **Step 2: Install dev dependencies**

Run: `npm install` (authorized once for P0 Task 1 only).
Expected: `node_modules/` created, no `ERESOLVE` errors. If the `@earendil-works/*` packages are not on the registry, install them from the local Pi installation path the parent supplies and record it in `.scratch/p0-shell/01-skeleton.md`.

- [ ] **Step 3: Write ports and types**

`src/domain/ports.ts` and `src/domain/types.ts`: copy the two code blocks from `docs/design/03-components.md` ("Shared types" and "Injected dependencies") verbatim.

- [ ] **Step 4: Write the failing fake test**

```ts
// test/fakes/memoryFs.spec.ts
import { describe, expect, it } from "vitest";
import { MemoryFs } from "./memoryFs.js";

describe("MemoryFs", () => {
  it("writeAtomic stores text and records mode", async () => {
    const fs = new MemoryFs();
    await fs.writeAtomic("/d/a.json", "{}", 0o600);
    expect(await fs.readText("/d/a.json")).toBe("{}");
    expect(fs.modes.get("/d/a.json")).toBe(0o600);
  });
  it("readText returns null for missing files", async () => {
    expect(await new MemoryFs().readText("/nope")).toBeNull();
  });
  it("tryCreateExclusive is true once", async () => {
    const fs = new MemoryFs();
    expect(await fs.tryCreateExclusive("/lock")).toBe(true);
    expect(await fs.tryCreateExclusive("/lock")).toBe(false);
    await fs.unlink("/lock");
    expect(await fs.tryCreateExclusive("/lock")).toBe(true);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run test/fakes/memoryFs.spec.ts`
Expected: FAIL, `Cannot find module './memoryFs.js'`.

- [ ] **Step 6: Write the fakes**

```ts
// test/fakes/memoryFs.ts
import type { FileSystem } from "../../src/domain/ports.js";

export class MemoryFs implements FileSystem {
  files = new Map<string, string>();
  modes = new Map<string, number>();
  mtimes = new Map<string, number>();
  now = 1_000;
  async readText(p: string) { return this.files.get(p) ?? null; }
  async writeAtomic(p: string, data: string, mode: number) {
    this.files.set(p, data); this.modes.set(p, mode); this.mtimes.set(p, this.now);
  }
  async mkdir(p: string, mode: number) { this.modes.set(p, mode); }
  async tryCreateExclusive(p: string) {
    if (this.files.has(p)) return false;
    this.files.set(p, ""); this.mtimes.set(p, this.now); return true;
  }
  async unlink(p: string) { this.files.delete(p); this.modes.delete(p); this.mtimes.delete(p); }
  async mtime(p: string) { return this.mtimes.get(p) ?? null; }
}
```

```ts
// test/fakes/fakeClock.ts
import type { Clock } from "../../src/domain/ports.js";

export class FakeClock implements Clock {
  private t = 0;
  private sleepers: Array<{ at: number; resolve: () => void }> = [];
  now() { return this.t; }
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run test/fakes/memoryFs.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Run the full check**

Run: `npm run check`
Expected: typecheck OK, biome OK, 3 tests pass.

- [ ] **Step 9: Commit (parent runs)**

```bash
git -c safe.directory='/mnt/sdcard/AI Workplace/pi-model-auto-switch' add package.json tsconfig.json biome.json vitest.config.ts LICENSE .gitignore src/domain test/fakes
git -c safe.directory='/mnt/sdcard/AI Workplace/pi-model-auto-switch' commit -m "chore: package skeleton, ports, test fakes"
```

---

### Task 2: WriteQueue

**Files:**

- Create: `src/config/writeQueue.ts`
- Test: `test/config/writeQueue.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `class WriteQueue { enqueue<T>(task: () => Promise<T>): Promise<T>; pending(): number }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { WriteQueue } from "../../src/config/writeQueue.js";

describe("WriteQueue", () => {
  it("runs tasks in enqueue order", async () => {
    const q = new WriteQueue(); const log: number[] = [];
    const slow = q.enqueue(async () => { await new Promise((r) => setTimeout(r, 10)); log.push(1); });
    const fast = q.enqueue(async () => { log.push(2); });
    await Promise.all([slow, fast]);
    expect(log).toEqual([1, 2]);
  });
  it("a rejected task rejects its caller and does not stop later tasks", async () => {
    const q = new WriteQueue();
    await expect(q.enqueue(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await q.enqueue(async () => 7)).toBe(7);
  });
  it("pending drops to 0", async () => {
    const q = new WriteQueue(); const p = q.enqueue(async () => 1);
    expect(q.pending()).toBe(1); await p; expect(q.pending()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/writeQueue.spec.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config/writeQueue.ts
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private count = 0;
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.count++;
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined).finally(() => { this.count--; });
    return run;
  }
  pending(): number { return this.count; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config/writeQueue.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit (parent runs)** `feat(config): write queue`

---

### Task 3: JsonStore

**Files:**

- Create: `src/config/jsonStore.ts`
- Test: `test/config/jsonStore.spec.ts`

**Interfaces:**

- Consumes: `FileSystem` (Task 1), `WriteQueue` (Task 2).
- Produces: `JsonStore<T>` with `load(): Promise<{ value: T; status: "ok" | "missing" | "corrupt" | "newer-version" | "migrated" }>` and `save(value: T): Promise<void>`; `StoreOptions<T>` as in `03-components.md`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { JsonStore } from "../../src/config/jsonStore.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { MemoryFs } from "../fakes/memoryFs.js";

type Doc = { version: number; a: number };
const make = (fs: MemoryFs, migrations = {}) =>
  new JsonStore<Doc>(fs, new WriteQueue(), { path: "/d/x.json", version: 2, defaults: () => ({ version: 2, a: 1 }), migrations });

describe("JsonStore", () => {
  it("missing file → defaults", async () => {
    const r = await make(new MemoryFs()).load();
    expect(r).toEqual({ value: { version: 2, a: 1 }, status: "missing" });
  });
  it("corrupt file → defaults, file untouched", async () => {
    const fs = new MemoryFs(); fs.files.set("/d/x.json", "{not json");
    const r = await make(fs).load();
    expect(r.status).toBe("corrupt"); expect(fs.files.get("/d/x.json")).toBe("{not json");
  });
  it("newer version → status newer-version and save refused", async () => {
    const fs = new MemoryFs(); fs.files.set("/d/x.json", JSON.stringify({ version: 9, a: 5 }));
    const s = make(fs); const r = await s.load();
    expect(r.status).toBe("newer-version");
    await expect(s.save({ version: 2, a: 3 })).rejects.toThrow(/newer/);
    expect(JSON.parse(fs.files.get("/d/x.json")!).a).toBe(5);
  });
  it("older version runs migrations in order", async () => {
    const fs = new MemoryFs(); fs.files.set("/d/x.json", JSON.stringify({ version: 1, a: 1 }));
    const r = await make(fs, { 1: (raw: unknown) => ({ ...(raw as Doc), version: 2, a: 10 }) }).load();
    expect(r).toEqual({ value: { version: 2, a: 10 }, status: "migrated" });
  });
  it("save writes 0600 and preserves unknown fields (C21, C6 pattern)", async () => {
    const fs = new MemoryFs(); fs.files.set("/d/x.json", JSON.stringify({ version: 2, a: 1, zzz: { keep: true } }));
    const s = make(fs); const { value } = await s.load(); await s.save({ ...value, a: 2 });
    expect(fs.modes.get("/d/x.json")).toBe(0o600);
    expect(JSON.parse(fs.files.get("/d/x.json")!)).toEqual({ version: 2, a: 2, zzz: { keep: true } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/jsonStore.spec.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config/jsonStore.ts
import type { FileSystem } from "../domain/ports.js";
import type { WriteQueue } from "./writeQueue.js";

export type LoadStatus = "ok" | "missing" | "corrupt" | "newer-version" | "migrated";
export interface StoreOptions<T> {
  path: string; version: number; defaults: () => T;
  migrations: Record<number, (raw: unknown) => unknown>; mode?: number;
}

export class JsonStore<T extends { version: number }> {
  private frozen = false;
  constructor(private fs: FileSystem, private queue: WriteQueue, private opts: StoreOptions<T>) {}

  async load(): Promise<{ value: T; status: LoadStatus }> {
    const text = await this.fs.readText(this.opts.path);
    if (text === null) return { value: this.opts.defaults(), status: "missing" };
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { this.frozen = true; return { value: this.opts.defaults(), status: "corrupt" }; }
    const v = (raw as { version?: unknown }).version;
    if (typeof v !== "number") { this.frozen = true; return { value: this.opts.defaults(), status: "corrupt" }; }
    if (v > this.opts.version) { this.frozen = true; return { value: this.opts.defaults(), status: "newer-version" }; }
    let migrated = false;
    for (let from = v; from < this.opts.version; from++) {
      const m = this.opts.migrations[from];
      if (!m) { this.frozen = true; return { value: this.opts.defaults(), status: "corrupt" }; }
      raw = m(raw); migrated = true;
    }
    return { value: raw as T, status: migrated ? "migrated" : "ok" };
  }

  save(value: T): Promise<void> {
    if (this.frozen) return Promise.reject(new Error(`refusing to overwrite ${this.opts.path}: newer or corrupt file`));
    return this.queue.enqueue(() =>
      this.fs.writeAtomic(this.opts.path, `${JSON.stringify(value, null, 2)}\n`, this.opts.mode ?? 0o600));
  }
}
```

Unknown fields are preserved because `load` returns the parsed object itself (with its extra keys) and `save` serializes whatever the caller spreads back; `ConfigStore` (Task 5) must always spread the loaded value rather than rebuild it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config/jsonStore.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit (parent runs)** `feat(config): versioned json store with fail-open`

---

### Task 4: redactSecret

**Files:**

- Create: `src/domain/redact.ts`
- Test: `test/domain/redact.spec.ts`

**Interfaces:**

- Consumes: `ProviderNode` (Task 1).
- Produces: `redactSecret(value: string): string`, `redactProvider(p: ProviderNode): ProviderNode`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { redactProvider, redactSecret } from "../../src/domain/redact.js";

describe("redactSecret (C22)", () => {
  it("keeps 3 head and 4 tail chars", () => {
    expect(redactSecret("demo-1234567890abcd")).toBe("dem…abcd");
  });
  it("short values collapse to an ellipsis", () => {
    expect(redactSecret("abcd")).toBe("…");
    expect(redactSecret("abcdefg")).toBe("…");
    expect(redactSecret("abcdefgh")).toBe("abc…efgh");
  });
  it("env references pass through", () => {
    expect(redactSecret("$OPENAI_KEY")).toBe("$OPENAI_KEY");
    expect(redactSecret("${OPENAI_KEY}")).toBe("${OPENAI_KEY}");
  });
});

describe("redactProvider", () => {
  it("redacts apiKey and auth-like headers, keeps others", () => {
    const p = redactProvider({ name: "r", baseUrl: "u", api: "openai-completions", apiKey: "demo-1234567890abcd",
      headers: { Authorization: "Bearer demo-9999999999zzzz", "X-Team": "a" }, models: [] });
    expect(p.apiKey).toBe("dem…abcd");
    expect(p.headers).toEqual({ Authorization: "Bea…zzzz", "X-Team": "a" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/domain/redact.spec.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/redact.ts
import type { ProviderNode } from "./types.js";

const ENV_REF = /^\$\{?[A-Z_][A-Z0-9_]*\}?$/;
const SECRET_HEADER = /key|token|auth/i;

export function redactSecret(value: string): string {
  if (ENV_REF.test(value)) return value;
  if (value.length < 8) return "…";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export function redactProvider(p: ProviderNode): ProviderNode {
  const headers = p.headers
    ? Object.fromEntries(Object.entries(p.headers).map(([k, v]) => [k, SECRET_HEADER.test(k) ? redactSecret(v) : v]))
    : undefined;
  return { ...p, ...(p.apiKey !== undefined ? { apiKey: redactSecret(p.apiKey) } : {}), ...(headers ? { headers } : {}) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/domain/redact.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit (parent runs)** `feat(domain): secret redaction`

---

### Task 5: ConfigStore and migrations

**Files:**

- Create: `src/config/migrations.ts`, `src/config/configStore.ts`
- Test: `test/config/configStore.spec.ts`, `test/config/migrations.spec.ts`

**Interfaces:**

- Consumes: `JsonStore` (Task 3), `WriteQueue`, `FileSystem`, `Settings`/`CatalogModel`/`KeyGroup`/`Chain` types.
- Produces: `ConfigFile`, `DEFAULT_SETTINGS`, `ConfigStore.open(fs, queue, dir)`, `get()`, `update(fn)`, `onChange(cb)`, `CONFIG_VERSION`, `STATE_VERSION`, `configMigrations`, `stateMigrations`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/config/migrations.spec.ts
import { describe, expect, it } from "vitest";
import { CONFIG_VERSION, STATE_VERSION, configMigrations, stateMigrations } from "../../src/config/migrations.js";

describe("migration tables", () => {
  it("cover every version below current", () => {
    for (let v = 1; v < CONFIG_VERSION; v++) expect(configMigrations[v]).toBeTypeOf("function");
    for (let v = 1; v < STATE_VERSION; v++) expect(stateMigrations[v]).toBeTypeOf("function");
  });
});
```

```ts
// test/config/configStore.spec.ts
import { describe, expect, it } from "vitest";
import { ConfigStore, DEFAULT_SETTINGS } from "../../src/config/configStore.js";
import { WriteQueue } from "../../src/config/writeQueue.js";
import { MemoryFs } from "../fakes/memoryFs.js";

describe("ConfigStore", () => {
  it("defaults", async () => {
    const s = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    expect(s.get().settings).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ listRows: 7, ttftTimeoutSeconds: 60, ttftAction: "cooldown-only",
      maxRetries: 5, errorHandlingMode: "smart", noProgressTimeoutSeconds: 90, reasoningEffort: "inherit", modelParameters: {} });
    expect(s.get().catalog).toEqual([]); expect(s.get().chains).toEqual([]); expect(s.get().keyGroups).toEqual([]);
  });
  it("update persists to /d/config.json with 0600 and fires onChange once", async () => {
    const fs = new MemoryFs(); const s = await ConfigStore.open(fs, new WriteQueue(), "/d");
    let n = 0; s.onChange(() => n++);
    await s.update((c) => { c.settings.listRows = 12; });
    expect(n).toBe(1); expect(fs.modes.get("/d/config.json")).toBe(0o600);
    expect(JSON.parse(fs.files.get("/d/config.json")!).settings.listRows).toBe(12);
  });
  it("rejects listRows outside 5–20", async () => {
    const s = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    await expect(s.update((c) => { c.settings.listRows = 4; })).rejects.toThrow(/listRows/);
    await expect(s.update((c) => { c.settings.listRows = 21; })).rejects.toThrow(/listRows/);
    expect(s.get().settings.listRows).toBe(7);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/config/configStore.spec.ts test/config/migrations.spec.ts`
Expected: FAIL, `Cannot find module` twice.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config/migrations.ts
export const CONFIG_VERSION = 1;
export const STATE_VERSION = 1;
export const configMigrations: Record<number, (raw: unknown) => unknown> = {};
export const stateMigrations: Record<number, (raw: unknown) => unknown> = {};
```

```ts
// src/config/configStore.ts
import type { FileSystem } from "../domain/ports";
import type { CatalogModel, Chain, KeyGroup, Settings } from "../domain/types";
import { JsonStore } from "./jsonStore";
import { CONFIG_VERSION, configMigrations } from "./migrations";
import type { WriteQueue } from "./writeQueue";

export interface ConfigFile { version: 1; settings: Settings; catalog: CatalogModel[]; keyGroups: KeyGroup[]; chains: Chain[]; [k: string]: unknown; }

export const DEFAULT_SETTINGS: Settings = {
  listRows: 7, ttftTimeoutSeconds: 60, ttftAction: "cooldown-only", maxRetries: 5,
  errorHandlingMode: "smart", noProgressTimeoutSeconds: 90, reasoningEffort: "inherit", modelParameters: {},
};
export const LIST_ROWS_MIN = 5;
export const LIST_ROWS_MAX = 20;

const defaults = (): ConfigFile => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, catalog: [], keyGroups: [], chains: [] });

function validate(c: ConfigFile): void {
  const r = c.settings.listRows;
  if (!Number.isInteger(r) || r < LIST_ROWS_MIN || r > LIST_ROWS_MAX) throw new Error(`listRows must be ${LIST_ROWS_MIN}–${LIST_ROWS_MAX}`);
}

export class ConfigStore {
  private listeners = new Set<() => void>();
  private constructor(private store: JsonStore<ConfigFile>, private value: ConfigFile, readonly loadStatus: string) {}

  static async open(fs: FileSystem, queue: WriteQueue, dir: string): Promise<ConfigStore> {
    const store = new JsonStore<ConfigFile>(fs, queue, { path: `${dir}/config.json`, version: CONFIG_VERSION, defaults, migrations: configMigrations });
    const { value, status } = await store.load();
    return new ConfigStore(store, { ...defaults(), ...value, settings: { ...DEFAULT_SETTINGS, ...value.settings } }, status);
  }
  get(): ConfigFile { return this.value; }
  async update(fn: (c: ConfigFile) => void): Promise<void> {
    const next: ConfigFile = structuredClone(this.value);
    fn(next); validate(next);
    await this.store.save(next);
    this.value = next;
    for (const l of this.listeners) l();
  }
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/config/configStore.spec.ts test/config/migrations.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit (parent runs)** `feat(config): config store with defaults and validation`

---

### Task 6: TabBar and KeyHints

**Files:**

- Create: `src/tui/primitives/tabBar.ts`, `src/tui/primitives/keyHints.ts`
- Test: `test/tui/tabBar.spec.ts`, `test/tui/keyHints.spec.ts`

**Interfaces:**

- Consumes: `truncateToWidth`, `visibleWidth` from `@earendil-works/pi-tui`.
- Produces: `TabBar` (`active`, `next()`, `prev()`, `set(i)`, `render(width): string`), `renderKeyHints(hints: Array<[string, string]>, width: number): string[]`.

- [ ] **Step 1: Confirm pi-tui exports**

Run: `node --input-type=module -e "import('@earendil-works/pi-tui').then(m => console.log(Object.keys(m).join(' '), '|', Object.keys(m.Key ?? {}).join(' ')))"`
Expected: output contains `truncateToWidth visibleWidth matchesKey Key`. Write the printed `Key` names into `.scratch/p0-shell/06-tabbar-keyhints.md`; use them in Tasks 7–11 wherever this plan writes `Key.<name>`.

- [ ] **Step 2: Write the failing tests**

```ts
// test/tui/tabBar.spec.ts
import { describe, expect, it } from "vitest";
import { TabBar } from "../../src/tui/primitives/tabBar.js";

describe("TabBar", () => {
  it("next and prev wrap", () => {
    const t = new TabBar(["A", "B", "C"]);
    t.prev(); expect(t.active).toBe(2); t.next(); expect(t.active).toBe(0);
  });
  it("render marks the active tab with brackets and numbers", () => {
    const t = new TabBar(["A", "B"]); t.set(1);
    expect(t.render(40)).toBe(" 1 A  [2 B]");
  });
});
```

```ts
// test/tui/keyHints.spec.ts
import { describe, expect, it } from "vitest";
import { renderKeyHints } from "../../src/tui/primitives/keyHints.js";

describe("renderKeyHints", () => {
  it("fits one line when short", () => {
    expect(renderKeyHints([["a", "add"], ["q", "quit"]], 40)).toEqual([" a add  q quit"]);
  });
  it("wraps to two lines, never three", () => {
    const many: Array<[string, string]> = Array.from({ length: 12 }, (_, i) => [`k${i}`, `action number ${i}`]);
    const lines = renderKeyHints(many, 40);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/tui/tabBar.spec.ts test/tui/keyHints.spec.ts`
Expected: FAIL, `Cannot find module` twice.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/tui/primitives/tabBar.ts
import { truncateToWidth } from "@earendil-works/pi-tui";

export class TabBar {
  active = 0;
  constructor(private labels: string[]) {}
  next(): void { this.active = (this.active + 1) % this.labels.length; }
  prev(): void { this.active = (this.active - 1 + this.labels.length) % this.labels.length; }
  set(i: number): void { if (i >= 0 && i < this.labels.length) this.active = i; }
  render(width: number): string {
    const parts = this.labels.map((l, i) => (i === this.active ? `[${i + 1} ${l}]` : ` ${i + 1} ${l} `));
    return truncateToWidth(parts.join(" ").trimEnd(), width);
  }
}
```

```ts
// src/tui/primitives/keyHints.ts
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function renderKeyHints(hints: Array<[key: string, label: string]>, width: number): string[] {
  const lines: string[] = [""];
  for (const [k, label] of hints) {
    const chunk = ` ${k} ${label} `;
    const cur = lines[lines.length - 1] ?? "";
    if (visibleWidth(cur + chunk) <= width || cur === "") lines[lines.length - 1] = cur + chunk;
    else if (lines.length < 2) lines.push(chunk);
    else break;
  }
  return lines.map((l) => truncateToWidth(l.trimEnd(), width));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/tui/tabBar.spec.ts test/tui/keyHints.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit (parent runs)** `feat(tui): tab bar and key hints`

---

### Task 7: ScrollList

**Files:**

- Create: `src/tui/primitives/scrollList.ts`
- Test: `test/tui/scrollList.spec.ts`

**Interfaces:**

- Consumes: `truncateToWidth` from pi-tui.
- Produces: `Row { text: string; marked?: boolean }`, `ScrollList` with `setRows`, `selected`, `toggleMark`, `markedIndices`, `up/down/pageUp/pageDown/home/end`, `render(width): string[]` (length = `listRows`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { ScrollList } from "../../src/tui/primitives/scrollList.js";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `row${i}` }));

describe("ScrollList (C19)", () => {
  it("renders exactly listRows lines, padding when short", () => {
    const l = new ScrollList({ listRows: 7 }); l.setRows(rows(3));
    expect(l.render(20)).toHaveLength(7);
  });
  it("no scrollbar when rows fit", () => {
    const l = new ScrollList({ listRows: 7 }); l.setRows(rows(7));
    for (const line of l.render(20)) expect(line).not.toMatch(/[█░]/);
  });
  it("scrollbar in last 2 columns when overflowing, thumb at top", () => {
    const l = new ScrollList({ listRows: 7 }); l.setRows(rows(21));
    const out = l.render(20);
    expect(out[0]!.slice(-2)).toBe(" █"); expect(out[6]!.slice(-2)).toBe(" ░");
    expect(out.filter((x) => x.endsWith("█"))).toHaveLength(2); // round(7*7/21)
  });
  it("selection stays visible and thumb moves to bottom at end", () => {
    const l = new ScrollList({ listRows: 7 }); l.setRows(rows(21)); l.end();
    const out = l.render(20);
    expect(out[6]).toMatch(/^▶ row20/); expect(out[6]!.slice(-2)).toBe(" █");
  });
  it("toggleMark only when multiSelect", () => {
    const a = new ScrollList({ listRows: 5 }); a.setRows(rows(2)); a.toggleMark();
    expect(a.markedIndices()).toEqual([]);
    const b = new ScrollList({ listRows: 5, multiSelect: true }); b.setRows(rows(2)); b.toggleMark();
    expect(b.markedIndices()).toEqual([0]); expect(b.render(20)[0]).toMatch(/^▶ \[x\] row0/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tui/scrollList.spec.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tui/primitives/scrollList.ts
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface Row { text: string; marked?: boolean }

export class ScrollList {
  private rows: Row[] = [];
  private top = 0;
  selected = 0;
  constructor(private opts: { listRows: number; multiSelect?: boolean }) {}

  setRows(rows: Row[]): void {
    this.rows = rows;
    this.selected = Math.min(this.selected, Math.max(0, rows.length - 1));
    this.clampTop();
  }
  setListRows(n: number): void { this.opts.listRows = n; this.clampTop(); }
  toggleMark(): void {
    const r = this.rows[this.selected];
    if (this.opts.multiSelect && r) r.marked = !r.marked;
  }
  markedIndices(): number[] { return this.rows.flatMap((r, i) => (r.marked ? [i] : [])); }
  up(): void { this.move(-1); }
  down(): void { this.move(1); }
  pageUp(): void { this.move(-this.opts.listRows); }
  pageDown(): void { this.move(this.opts.listRows); }
  home(): void { this.move(-Infinity); }
  end(): void { this.move(Infinity); }

  render(width: number): string[] {
    const n = this.opts.listRows;
    const overflow = this.rows.length > n;
    const textWidth = overflow ? width - 2 : width;
    const thumbLen = overflow ? Math.max(1, Math.round((n * n) / this.rows.length)) : 0;
    const thumbTop = overflow ? Math.round((this.top / (this.rows.length - n)) * (n - thumbLen)) : 0;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = this.rows[this.top + i];
      let text = "";
      if (r) {
        const mark = this.opts.multiSelect ? (r.marked ? "[x] " : "[ ] ") : "";
        text = `${this.top + i === this.selected ? "▶" : " "} ${mark}${r.text}`;
      }
      text = truncateToWidth(text, textWidth);
      text += " ".repeat(Math.max(0, textWidth - visibleWidth(text)));
      if (overflow) text += i >= thumbTop && i < thumbTop + thumbLen ? " █" : " ░";
      out.push(text);
    }
    return out;
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected + delta));
    this.clampTop();
  }
  private clampTop(): void {
    const n = this.opts.listRows;
    if (this.selected < this.top) this.top = this.selected;
    if (this.selected >= this.top + n) this.top = this.selected - n + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, this.rows.length - n)));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tui/scrollList.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit (parent runs)** `feat(tui): scroll list with fixed height and scrollbar`

---

### Task 8: strings, Form, Confirm

**Files:**

- Create: `src/strings.ts`, `src/tui/primitives/form.ts`, `src/tui/primitives/confirm.ts`
- Test: `test/tui/form.spec.ts`, `test/tui/confirm.spec.ts`, `test/strings.spec.ts`

**Interfaces:**

- Consumes: `redactSecret` (Task 4), `Key`, `matchesKey` from pi-tui.
- Produces: `S` (strings table), `Field` union and `Form` as in `03-components.md`, `Confirm { constructor(title: string, details: string[], onConfirm, onCancel); render(width): string[]; handleInput(data): void }`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/strings.spec.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
}

describe("strings live in src/strings.ts", () => {
  it("no multi-word literal longer than 12 chars in src/tui", () => {
    const offenders: string[] = [];
    for (const f of walk("src/tui")) {
      for (const m of readFileSync(f, "utf8").matchAll(/"([^"\n]{13,})"/g)) if (/\s/.test(m[1]!)) offenders.push(`${f}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });
});
```

```ts
// test/tui/form.spec.ts
import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { Form } from "../../src/tui/primitives/form";

describe("Form", () => {
  it("Tab moves focus, number clamps, secret redacts", () => {
    const f = new Form([
      { kind: "text", key: "k", label: "Key", value: "demo-1234567890abcd", secret: true },
      { kind: "number", key: "n", label: "N", value: 7, min: 5, max: 20 },
    ], vi.fn(), vi.fn());
    expect(f.render(60)[0]).toContain("dem…abcd");
    f.handleInput(Key.tab); for (let i = 0; i < 30; i++) f.handleInput(Key.right);
    expect(f.render(60)[1]).toContain("20");
  });
  it("select shows warning for the current option", () => {
    const f = new Form([{ kind: "select", key: "a", label: "ttftAction", value: "abort", options: ["cooldown-only", "abort"],
      warning: { abort: "WARN TEXT" } }], vi.fn(), vi.fn());
    expect(f.render(60).join("\n")).toContain("WARN TEXT");
    f.handleInput(Key.left);
    expect(f.render(60).join("\n")).not.toContain("WARN TEXT");
  });
  it("Enter on last field submits values; Esc cancels", () => {
    const submit = vi.fn(); const cancel = vi.fn();
    const f = new Form([{ kind: "number", key: "n", label: "N", value: 3 }], submit, cancel);
    f.handleInput(Key.enter); expect(submit).toHaveBeenCalledWith({ n: 3 });
    f.handleInput(Key.escape); expect(cancel).toHaveBeenCalled();
  });
});
```

```ts
// test/tui/confirm.spec.ts
import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { Confirm } from "../../src/tui/primitives/confirm";

describe("Confirm", () => {
  it("defaults to Cancel; Left then Enter confirms", () => {
    const ok = vi.fn(); const no = vi.fn();
    const c = new Confirm("Delete?", ["detail"], ok, no);
    c.handleInput(Key.enter); expect(no).toHaveBeenCalledTimes(1);
    c.handleInput(Key.left); c.handleInput(Key.enter); expect(ok).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tui/form.spec.ts test/tui/confirm.spec.ts test/strings.spec.ts`
Expected: FAIL, `Cannot find module` for form and confirm; strings test passes vacuously (no `src/tui` literals yet) or fails on missing dir; either is acceptable at this step.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/strings.ts
export const S = {
  appTitle: "pi-model-failover",
  tabs: ["Model Manager", "Chains", "History", "Settings"],
  memoryMode: "[memory mode]",
  needsTui: "pi-model-failover needs the TUI",
  abortWarning: "Aborting still bills the prompt tokens of the aborted request on most providers/relays.",
  settingsHeader: "Global settings (targets without a value use these)",
  resetAll: "Reset all cooldowns and manual recovery",
  resetAllConfirm: (n: number) => `Reset ${n} targets?`,
  emptyList: "Nothing here yet",
  confirm: "Confirm", cancel: "Cancel",
  hints: {
    global: [["Tab", "next tab"], ["?", "help"], ["q", "quit"]] as Array<[string, string]>,
    settings: [["↑↓", "field"], ["◂ ▸", "change"], ["Enter", "save or activate"], ["?", "help"], ["q", "quit"]] as Array<[string, string]>,
    form: [["Tab", "next field"], ["Shift+Tab", "prev"], ["◂ ▸", "change option"], ["Enter", "submit"], ["Esc", "cancel"]] as Array<[string, string]>,
    confirm: [["◂ ▸", "choose"], ["Enter", "confirm"], ["Esc", "cancel"]] as Array<[string, string]>,
  },
  help: { global: "Global", listRowsHint: "(5–20)", zeroDisables: "(0 disables)" },
} as const;
```

```ts
// src/tui/primitives/form.ts
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { redactSecret } from "../../domain/redact";

export type Field =
  | { kind: "text"; key: string; label: string; value: string; secret?: boolean; multiline?: boolean }
  | { kind: "number"; key: string; label: string; value: number; min?: number; max?: number; step?: number }
  | { kind: "select"; key: string; label: string; value: string; options: string[]; warning?: Partial<Record<string, string>> }
  | { kind: "multiselect"; key: string; label: string; value: string[]; options: string[] };

export class Form {
  focus = 0;
  private cursor = 0; // option index for multiselect
  constructor(private fields: Field[], private onSubmit: (v: Record<string, unknown>) => void, private onCancel: () => void) {}

  values(): Record<string, unknown> { return Object.fromEntries(this.fields.map((f) => [f.key, f.value])); }

  render(width: number): string[] {
    const out: string[] = [];
    this.fields.forEach((f, i) => {
      const pre = i === this.focus ? "▶ " : "  ";
      const label = f.label.padEnd(26);
      let value: string;
      switch (f.kind) {
        case "text": value = f.secret ? redactSecret(f.value) : f.value; break;
        case "number": value = String(f.value); break;
        case "select": value = `${f.value}  ◂ ▸`; break;
        case "multiselect": value = f.options.map((o, j) => `${j === this.cursor && i === this.focus ? ">" : " "}[${f.value.includes(o) ? "x" : " "}] ${o}`).join("  "); break;
      }
      out.push(truncateToWidth(`${pre}${label}${value}`, width));
      if (f.kind === "select" && f.warning?.[f.value]) out.push(truncateToWidth(`    ⚠ ${f.warning[f.value]}`, width));
    });
    return out;
  }

  handleInput(data: string): void {
    const f = this.fields[this.focus];
    if (!f) return;
    if (matchesKey(data, Key.escape)) return this.onCancel();
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) { this.focus = (this.focus + 1) % this.fields.length; return; }
    if (matchesKey(data, Key.shiftTab) || matchesKey(data, Key.up)) { this.focus = (this.focus - 1 + this.fields.length) % this.fields.length; return; }
    if (matchesKey(data, Key.enter)) { if (this.focus === this.fields.length - 1) return this.onSubmit(this.values()); this.focus++; return; }
    if (f.kind === "select") {
      const i = f.options.indexOf(f.value);
      if (matchesKey(data, Key.left)) f.value = f.options[(i - 1 + f.options.length) % f.options.length] ?? f.value;
      if (matchesKey(data, Key.right)) f.value = f.options[(i + 1) % f.options.length] ?? f.value;
      return;
    }
    if (f.kind === "multiselect") {
      if (matchesKey(data, Key.left)) this.cursor = Math.max(0, this.cursor - 1);
      if (matchesKey(data, Key.right)) this.cursor = Math.min(f.options.length - 1, this.cursor + 1);
      if (data === " ") { const o = f.options[this.cursor]!; f.value = f.value.includes(o) ? f.value.filter((x) => x !== o) : [...f.value, o]; }
      return;
    }
    if (f.kind === "number") {
      if (matchesKey(data, Key.left)) return this.step(f, -1);
      if (matchesKey(data, Key.right)) return this.step(f, 1);
      if (data === "\x7f" || data === "\b") { f.value = Math.floor(f.value / 10); return; }
      if (/^[0-9]$/.test(data)) { f.value = this.clamp(f, f.value * 10 + Number(data)); return; }
      if (data === "." || data === "-") return;
      return;
    }
    // text
    if (data === "\x7f" || data === "\b") { f.value = f.value.slice(0, -1); return; }
    if (data === "\r" || data === "\n") { if (f.multiline) f.value += "\n"; return; }
    if (data.length >= 1 && !data.startsWith("\x1b")) f.value += data;
  }

  private step(f: Extract<Field, { kind: "number" }>, dir: 1 | -1): void { f.value = this.clamp(f, f.value + dir * (f.step ?? 1)); }
  private clamp(f: Extract<Field, { kind: "number" }>, v: number): number {
    return Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, v));
  }
}
```

Note for the P1 key-group form: the `Keys` multiline field also needs decimal multipliers per line; that is text, so the `number` field's integer-only input is fine for P0 (listRows, timeouts, retries are integers). The multiplier field in P1 is a `text` field parsed with `Number()` on submit.

```ts
// src/tui/primitives/confirm.ts
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { S } from "../../strings";

export class Confirm {
  private choice: 0 | 1 = 1; // 1 = Cancel (default)
  constructor(private title: string, private details: string[], private onConfirm: () => void, private onCancel: () => void) {}
  render(width: number): string[] {
    const btn = (label: string, i: 0 | 1) => (this.choice === i ? `▶[ ${label} ]` : ` [ ${label} ]`);
    return [this.title, ...this.details.slice(0, 3), "", `${btn(S.confirm, 0)}   ${btn(S.cancel, 1)}`].map((l) => truncateToWidth(l, width));
  }
  handleInput(data: string): void {
    if (matchesKey(data, Key.left)) this.choice = 0;
    else if (matchesKey(data, Key.right)) this.choice = 1;
    else if (matchesKey(data, Key.enter)) (this.choice === 0 ? this.onConfirm : this.onCancel)();
    else if (matchesKey(data, Key.escape)) this.onCancel();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/tui/form.spec.ts test/tui/confirm.spec.ts test/strings.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit (parent runs)** `feat(tui): form, confirm, strings table`

---

### Task 9: HelpOverlay

**Files:**

- Create: `src/tui/primitives/helpOverlay.ts`
- Test: `test/tui/helpOverlay.spec.ts`

**Interfaces:**

- Consumes: `truncateToWidth`.
- Produces: `HelpOverlay { constructor(sections: Array<{ title: string; hints: Array<[string, string]> }>); visible: boolean; toggle(): void; render(width, height): string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { HelpOverlay } from "../../src/tui/primitives/helpOverlay";

describe("HelpOverlay (C20)", () => {
  it("toggle flips and render fills the requested height", () => {
    const h = new HelpOverlay([{ title: "Global", hints: [["?", "help"], ["q", "quit"]] }]);
    expect(h.visible).toBe(false); h.toggle(); expect(h.visible).toBe(true);
    const out = h.render(40, 12);
    expect(out).toHaveLength(12); expect(out[0]).toContain("Global"); expect(out[1]).toContain("?");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tui/helpOverlay.spec.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tui/primitives/helpOverlay.ts
import { truncateToWidth } from "@earendil-works/pi-tui";

export class HelpOverlay {
  visible = false;
  constructor(private sections: Array<{ title: string; hints: Array<[string, string]> }>) {}
  setSections(sections: Array<{ title: string; hints: Array<[string, string]> }>): void { this.sections = sections; }
  toggle(): void { this.visible = !this.visible; }
  render(width: number, height: number): string[] {
    const lines: string[] = [];
    for (const s of this.sections) {
      lines.push(s.title);
      for (const [k, label] of s.hints) lines.push(`  ${k.padEnd(10)} ${label}`);
      lines.push("");
    }
    const out = lines.slice(0, height).map((l) => truncateToWidth(l, width));
    while (out.length < height) out.push("");
    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tui/helpOverlay.spec.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit (parent runs)** `feat(tui): help overlay`

---

### Task 10: App shell and Settings tab

**Files:**

- Create: `src/tui/app.ts`, `src/tui/tabs/settings.ts`, `src/tui/tabs/modelManager.ts`, `src/tui/tabs/chains.ts`, `src/tui/tabs/history.ts`
- Test: `test/tui/app.spec.ts`, `test/tui/settings.spec.ts`

**Interfaces:**

- Consumes: `TabBar`, `ScrollList`, `renderKeyHints`, `HelpOverlay`, `Form`, `Confirm`, `ConfigStore`, `S`.
- Produces: `TabComponent { render(width, listRows): string[]; handleInput(data): void; hints(): Array<[string,string]>; helpTitle(): string }`; `createApp(deps: AppDeps): PiComponent` where `AppDeps = { config: ConfigStore; memoryMode: () => boolean; resetAll: () => Promise<number>; close: () => void }` and `PiComponent = { render(width: number): string[]; handleInput(data: string): void; invalidate?(): void; focused?: boolean }`. P1–P3 replace the three placeholder tabs; `AppDeps` grows by one field per tab then.

- [ ] **Step 1: Write the failing tests**

```ts
// test/tui/app.spec.ts
import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { ConfigStore } from "../../src/config/configStore";
import { WriteQueue } from "../../src/config/writeQueue";
import { createApp } from "../../src/tui/app";
import { MemoryFs } from "../fakes/memoryFs";

const mk = async () => {
  const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
  let closed = false;
  const app = createApp({ config, memoryMode: () => false, resetAll: async () => 0, close: () => { closed = true; } });
  return { app, config, closed: () => closed };
};

describe("app frame (C19, C20)", () => {
  it("height = 4 fixed + listRows + hint lines on every tab", async () => {
    const { app } = await mk();
    for (const k of ["1", "2", "3", "4"]) {
      app.handleInput(k);
      const h = app.render(78).length;
      expect(h === 4 + 7 + 1 || h === 4 + 7 + 2).toBe(true);
    }
  });
  it("Tab cycles, 2 jumps to Chains", async () => {
    const { app } = await mk();
    app.handleInput("2"); expect(app.render(78)[1]).toContain("[2 Chains]");
    app.handleInput(Key.tab); expect(app.render(78)[1]).toContain("[3 History]");
    app.handleInput(Key.shiftTab); expect(app.render(78)[1]).toContain("[2 Chains]");
  });
  it("? opens help, swallows keys, ? closes", async () => {
    const { app } = await mk();
    app.handleInput("?"); expect(app.render(78).join("\n")).toContain("Global");
    app.handleInput("2"); app.handleInput("?");
    expect(app.render(78)[1]).toContain("[1 Model Manager]");
  });
  it("q closes", async () => { const { app, closed } = await mk(); app.handleInput("q"); expect(closed()).toBe(true); });
  it("listRows change resizes every tab", async () => {
    const { app, config } = await mk();
    await config.update((c) => { c.settings.listRows = 12; });
    app.handleInput("1");
    const h = app.render(78).length; expect(h === 4 + 12 + 1 || h === 4 + 12 + 2).toBe(true);
  });
});
```

```ts
// test/tui/settings.spec.ts
import { Key } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../../src/config/configStore";
import { WriteQueue } from "../../src/config/writeQueue";
import { S } from "../../src/strings";
import { SettingsTab } from "../../src/tui/tabs/settings";
import { MemoryFs } from "../fakes/memoryFs";

describe("SettingsTab", () => {
  it("shows the abort warning only when ttftAction is abort", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    expect(t.render(78, 7).join("\n")).not.toContain(S.abortWarning.slice(0, 20));
    t.handleInput(Key.down); t.handleInput(Key.down); t.handleInput(Key.right); // ttftAction → abort
    expect(t.render(78, 7).join("\n")).toContain(S.abortWarning.slice(0, 20));
  });
  it("Enter saves settings; listRows out of range is refused and value restored", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const t = new SettingsTab(config, async () => 0);
    for (let i = 0; i < 5; i++) t.handleInput(Key.right); // listRows 7 → 12 (right steps number)
    await t.handleInput(Key.enter);
    expect(config.get().settings.listRows).toBe(12);
  });
  it("reset button asks for confirmation then calls resetAll", async () => {
    const config = await ConfigStore.open(new MemoryFs(), new WriteQueue(), "/d");
    const resetAll = vi.fn(async () => 3);
    const t = new SettingsTab(config, resetAll);
    for (let i = 0; i < 6; i++) t.handleInput(Key.down);   // focus reset button
    t.handleInput(Key.enter);                               // opens Confirm
    expect(t.render(78, 7).join("\n")).toContain(S.resetAllConfirm(0).slice(0, 5));
    t.handleInput(Key.left); await t.handleInput(Key.enter);
    expect(resetAll).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tui/app.spec.ts test/tui/settings.spec.ts`
Expected: FAIL, `Cannot find module` twice.

- [ ] **Step 3: Write the tab contract and placeholder tabs**

```ts
// src/tui/tabs/history.ts   (same shape for modelManager.ts and chains.ts with their own helpTitle)
import { ScrollList } from "../primitives/scrollList";
import { S } from "../../strings";

export interface TabComponent {
  render(width: number, listRows: number): string[];
  handleInput(data: string): void | Promise<void>;
  hints(): Array<[string, string]>;
  helpTitle(): string;
}

export class HistoryTab implements TabComponent {
  private list = new ScrollList({ listRows: 7 });
  render(width: number, listRows: number): string[] {
    this.list.setListRows(listRows);
    this.list.setRows([{ text: S.emptyList }]);
    return ["", ...this.list.render(width)];   // line 1 = list header (empty in P0)
  }
  handleInput(): void {}
  hints(): Array<[string, string]> { return S.hints.global; }
  helpTitle(): string { return S.tabs[2]; }
}
```

`modelManager.ts` exports `ModelManagerTab` (`helpTitle` → `S.tabs[0]`) and `chains.ts` exports `ChainsTab` (`S.tabs[1]`) with identical bodies. Put `TabComponent` in `history.ts` only if it stays there; otherwise move it to `src/tui/tabs/tab.ts` and add a one-line section to `03-components.md`.

- [ ] **Step 4: Write SettingsTab**

```ts
// src/tui/tabs/settings.ts
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../../config/configStore";
import { LIST_ROWS_MAX, LIST_ROWS_MIN } from "../../config/configStore";
import type { ErrorHandlingMode, TtftAction } from "../../domain/types";
import { S } from "../../strings";
import { Confirm } from "../primitives/confirm";
import { type Field, Form } from "../primitives/form";
import type { TabComponent } from "./history";

export class SettingsTab implements TabComponent {
  private form: Form;
  private confirm: Confirm | null = null;
  private onReset = false;   // focus on the reset button (after the last field)

  constructor(private config: ConfigStore, private resetAll: () => Promise<number>) {
    this.form = this.buildForm();
    config.onChange(() => { this.form = this.buildForm(); });
  }

  private buildForm(): Form {
    const s = this.config.get().settings;
    const fields: Field[] = [
      { kind: "number", key: "listRows", label: `listRows ${S.help.listRowsHint}`, value: s.listRows, min: LIST_ROWS_MIN, max: LIST_ROWS_MAX },
      { kind: "number", key: "ttftTimeoutSeconds", label: `ttftTimeoutSeconds ${S.help.zeroDisables}`, value: s.ttftTimeoutSeconds, min: 0, max: 3600 },
      { kind: "select", key: "ttftAction", label: "ttftAction", value: s.ttftAction, options: ["cooldown-only", "abort"], warning: { abort: S.abortWarning } },
      { kind: "number", key: "maxRetries", label: "maxRetries", value: s.maxRetries, min: 0, max: 50 },
      { kind: "select", key: "errorHandlingMode", label: "errorHandlingMode", value: s.errorHandlingMode, options: ["smart", "switch", "retry"] },
      { kind: "number", key: "noProgressTimeoutSeconds", label: "noProgressTimeoutSeconds", value: s.noProgressTimeoutSeconds, min: 0, max: 3600 },
    ];
    return new Form(fields, (v) => void this.save(v), () => {});
  }

  private async save(v: Record<string, unknown>): Promise<void> {
    try {
      await this.config.update((c) => {
        c.settings.listRows = v.listRows as number;
        c.settings.ttftTimeoutSeconds = v.ttftTimeoutSeconds as number;
        c.settings.ttftAction = v.ttftAction as TtftAction;
        c.settings.maxRetries = v.maxRetries as number;
        c.settings.errorHandlingMode = v.errorHandlingMode as ErrorHandlingMode;
        c.settings.noProgressTimeoutSeconds = v.noProgressTimeoutSeconds as number;
      });
    } catch { this.form = this.buildForm(); }
  }

  render(width: number, listRows: number): string[] {
    if (this.confirm) return [S.settingsHeader, ...this.confirm.render(width)].slice(0, listRows + 1);
    const button = `${this.onReset ? "▶" : " "} [ ${S.resetAll} ]`;
    const body = [...this.form.render(width), truncateToWidth(button, width)];
    const start = Math.max(0, body.length - listRows);
    const visible = this.onReset ? body.slice(start) : body.slice(0, listRows);
    while (visible.length < listRows) visible.push("");
    return [S.settingsHeader, ...visible];
  }

  async handleInput(data: string): Promise<void> {
    if (this.confirm) { this.confirm.handleInput(data); return; }
    if (this.onReset) {
      if (matchesKey(data, Key.up)) { this.onReset = false; return; }
      if (matchesKey(data, Key.enter)) {
        this.confirm = new Confirm(S.resetAllConfirm(0), [], async () => { this.confirm = null; await this.resetAll(); }, () => { this.confirm = null; });
      }
      return;
    }
    if (matchesKey(data, Key.down) && this.form.focus === 5) { this.onReset = true; return; }
    if (matchesKey(data, Key.enter)) { await this.save(this.form.values()); return; }
    this.form.handleInput(data);
  }

  hints(): Array<[string, string]> { return this.confirm ? S.hints.confirm : S.hints.settings; }
  helpTitle(): string { return S.tabs[3]; }
}
```

The reset confirmation count (`S.resetAllConfirm(n)`) receives the real target count in P2 when `SharedState` exists; P0 passes `0` and the P2 task updates the call.

- [ ] **Step 5: Write the app**

```ts
// src/tui/app.ts
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../config/configStore";
import { S } from "../strings";
import { HelpOverlay } from "./primitives/helpOverlay";
import { renderKeyHints } from "./primitives/keyHints";
import { TabBar } from "./primitives/tabBar";
import { ChainsTab } from "./tabs/chains";
import { HistoryTab, type TabComponent } from "./tabs/history";
import { ModelManagerTab } from "./tabs/modelManager";
import { SettingsTab } from "./tabs/settings";

export interface AppDeps { config: ConfigStore; memoryMode: () => boolean; resetAll: () => Promise<number>; close: () => void; }
export interface PiComponent { render(width: number): string[]; handleInput(data: string): void; invalidate?(): void; focused?: boolean; }

export function createApp(deps: AppDeps): PiComponent {
  const tabs: TabComponent[] = [new ModelManagerTab(), new ChainsTab(), new HistoryTab(), new SettingsTab(deps.config, deps.resetAll)];
  const bar = new TabBar([...S.tabs]);
  const help = new HelpOverlay([]);
  let lastHeight = 12;

  const render = (width: number): string[] => {
    const listRows = deps.config.get().settings.listRows;
    const tab = tabs[bar.active]!;
    if (help.visible) {
      help.setSections([{ title: S.help.global, hints: S.hints.global }, { title: tab.helpTitle(), hints: tab.hints() }]);
      return help.render(width, lastHeight);
    }
    const title = deps.memoryMode() ? `${S.appTitle}  ${S.memoryMode}` : S.appTitle;
    const body = tab.render(width, listRows);   // body[0] = list header, then listRows lines
    const out = [truncateToWidth(` ${title}`, width), ` ${bar.render(width - 1)}`, ...body, "─".repeat(width), ...renderKeyHints(tab.hints(), width)];
    lastHeight = out.length;
    return out;
  };

  const handleInput = (data: string): void => {
    if (data === "?") { help.toggle(); return; }
    if (help.visible) { if (matchesKey(data, Key.escape)) help.toggle(); return; }
    if (data === "q") { deps.close(); return; }
    if (matchesKey(data, Key.tab)) { bar.next(); return; }
    if (matchesKey(data, Key.shiftTab)) { bar.prev(); return; }
    if (/^[1-4]$/.test(data)) { bar.set(Number(data) - 1); return; }
    void tabs[bar.active]!.handleInput(data);
  };

  return { render, handleInput, focused: true };
}
```

`Esc` at top level is routed to the active tab in P0 (tabs decide whether they have a sub-screen); the P1 Model Manager task adds `close()` on `Esc` when no sub-screen is open.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/tui/app.spec.ts test/tui/settings.spec.ts test/strings.spec.ts`
Expected: PASS, 9 tests. If `strings.spec.ts` flags a literal in `src/tui`, move that literal into `S`.

- [ ] **Step 7: Commit (parent runs)** `feat(tui): app shell with tabs, help overlay, settings tab`

---

### Task 11: Node adapters and extension entry

**Files:**

- Create: `src/adapters/nodeFs.ts`, `src/index.ts`
- Create: `test/fakes/fakePi.ts`
- Test: `test/adapters/nodeFs.spec.ts`, `test/index.spec.ts`

**Interfaces:**

- Consumes: `FileSystem`, `Clock`, `ConfigStore`, `WriteQueue`, `createApp`, Pi's `ExtensionAPI`, `getAgentDir`.
- Produces: `nodeFs: FileSystem`, `systemClock: Clock`, `export default async function (pi: ExtensionAPI)`, `FakePi` recorder with `commands: Map<string, fn>`, `handlers: Map<string, fn[]>`, `providers: Map<string, unknown>`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/adapters/nodeFs.spec.ts (real fs in a temp dir)
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeFs } from "../../src/adapters/nodeFs";

describe("nodeFs", () => {
  it("writeAtomic writes via tmp+rename with the requested mode (C21)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmf-"));
    const p = join(dir, "a.json");
    await nodeFs.writeAtomic(p, "{}", 0o600);
    expect(readFileSync(p, "utf8")).toBe("{}");
    if (process.platform !== "android") expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(await nodeFs.readText(join(dir, "missing"))).toBeNull();
    expect(await nodeFs.tryCreateExclusive(join(dir, "lock"))).toBe(true);
    expect(await nodeFs.tryCreateExclusive(join(dir, "lock"))).toBe(false);
  });
});
```

```ts
// test/fakes/fakePi.ts
export class FakePi {
  commands = new Map<string, (args: unknown, ctx: unknown) => unknown>();
  handlers = new Map<string, Array<(...a: unknown[]) => unknown>>();
  providers = new Map<string, unknown>();
  registerCommand(name: string, spec: { handler: (args: unknown, ctx: unknown) => unknown } | ((args: unknown, ctx: unknown) => unknown)) {
    this.commands.set(name, typeof spec === "function" ? spec : spec.handler);
  }
  registerProvider(id: string, cfg: unknown) { this.providers.set(id, cfg); }
  unregisterProvider(id: string) { this.providers.delete(id); }
  on(event: string, fn: (...a: unknown[]) => unknown) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]); }
}
```

```ts
// test/index.spec.ts
import { describe, expect, it, vi } from "vitest";
import { FakePi } from "./fakes/fakePi";

vi.mock("@earendil-works/pi-coding-agent", async (orig) => ({ ...(await orig<object>()), getAgentDir: () => process.env.PMF_TEST_DIR }));
process.env.PMF_TEST_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "pmf-agent-"));

describe("extension entry", () => {
  it("registers /failover and session hooks; non-TUI mode notifies", async () => {
    const { default: factory } = await import("../src/index");
    const pi = new FakePi();
    await factory(pi as never);
    expect(pi.commands.has("failover")).toBe(true);
    expect(pi.handlers.has("session_start")).toBe(true);
    expect(pi.handlers.has("session_shutdown")).toBe(true);
    const notify = vi.fn();
    await pi.commands.get("failover")!({}, { mode: "rpc", ui: { notify, custom: vi.fn() } });
    expect(notify).toHaveBeenCalledWith("pi-model-failover needs the TUI", "warning");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/adapters/nodeFs.spec.ts test/index.spec.ts`
Expected: FAIL, `Cannot find module` twice.

- [ ] **Step 3: Write nodeFs**

```ts
// src/adapters/nodeFs.ts
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { Clock, FileSystem } from "../domain/ports";

export const nodeFs: FileSystem = {
  async readText(p) { try { return await readFile(p, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } },
  async writeAtomic(p, data, mode) {
    const tmp = `${p}.tmp`;
    const fh = await open(tmp, "w", mode);
    try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
    await rename(tmp, p);
  },
  async mkdir(p, mode) { await mkdir(p, { recursive: true, mode }); },
  async tryCreateExclusive(p) {
    try { const fh = await open(p, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); await fh.close(); return true; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return false; throw e; }
  },
  async unlink(p) { try { await unlink(p); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } },
  async mtime(p) { try { return (await stat(p)).mtimeMs; } catch { return null; } },
};

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) => sleep(ms, undefined, { signal }),
};
```

- [ ] **Step 4: Write index.ts**

```ts
// src/index.ts
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ConfigStore } from "./config/configStore";
import { WriteQueue } from "./config/writeQueue";
import { nodeFs } from "./adapters/nodeFs";
import { S } from "./strings";
import { createApp } from "./tui/app";

export default async function (pi: ExtensionAPI): Promise<void> {
  const dir = `${getAgentDir()}/pi-model-failover`;
  await nodeFs.mkdir(dir, 0o700);
  const queue = new WriteQueue();
  const config = await ConfigStore.open(nodeFs, queue, dir);

  // P1 adds: models.json read + registrar.syncOwned. P2 adds: SharedState, registrar.syncFailover.
  const refresh = async (): Promise<void> => {};

  pi.registerCommand("failover", {
    description: "Manage providers, failover chains, history",
    handler: async (_args: unknown, ctx: { mode: string; ui: { notify: (m: string, level: string) => void; custom: (c: unknown) => Promise<unknown> } }) => {
      if (ctx.mode !== "tui") { ctx.ui.notify(S.needsTui, "warning"); return; }
      await ctx.ui.custom((done: () => void) =>
        createApp({ config, memoryMode: () => false, resetAll: async () => 0, close: done }));
    },
  });

  pi.on("session_start", refresh);
  pi.on("session_shutdown", async () => { /* P2: state.flush(); P3: history.flush() */ });
}
```

Check `ctx.ui.custom`'s exact signature in the installed `@earendil-works/pi-coding-agent` types (Task 11 Step 5); if it takes a component instance rather than a factory receiving `done`, build the component first and pass a `close` that calls the resolver the API provides. Record the resolved signature in `.scratch/p0-shell/11-entry.md` and update `03-components.md` `tui/app.ts` if the `PiComponent` shape differs.

- [ ] **Step 5: Confirm Pi types compile**

Run: `npx tsc --noEmit`
Expected: no errors. If `registerCommand`'s spec shape or `ctx.ui.custom` differ, adapt `index.ts` only (not the app) and re-run.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/adapters/nodeFs.spec.ts test/index.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Full check and manual run**

Run: `npm run check`
Expected: all green.

Run: `pi -e ./src/index.ts`, then `/failover`.
Expected: four tabs; `Tab`, `Shift+Tab`, `1`–`4` switch; Settings shows six fields and the reset button; setting `ttftAction` to `abort` shows the billing warning; `listRows` 12 shows 12 rows on every tab; `?` opens and closes help; `q` closes.

- [ ] **Step 8: Commit (parent runs)** `feat: extension entry, node fs adapter`

---

## P0 self-review checklist

- Spec coverage: C19 (Task 7, 10), C20 (Task 9, 10), C21 (Task 3, 11), C22 (Task 4), listRows bound (Task 5, 10), abort warning text (Task 8, 10), TUI-only guard (Task 11). ✔
- Type consistency: `FileSystem`/`Clock` (Task 1) used unchanged in Tasks 3, 5, 11; `TabComponent` shape shared by Tasks 10; `Form.focus`, `Form.values()` used by `SettingsTab`. ✔
- No placeholders: every code step has its code; the two "confirm against installed types" steps are real verification steps with recorded output.

---

## Task index for P1–P4

Expanded into a full plan (`docs/design/07-plan-p<N>.md`) when the phase starts. Each row: task, files, acceptance.

### P1 Model Manager

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 1 | Map Pi models.json loader, `ModelRegistry`, `ModelRuntime.create` (explore, read-only) | `.scratch/p1-model-manager/01-map.md` | exact TS signatures recorded |
| 2 | `domain/catalog.ts` | `src/domain/catalog.ts`, `test/domain/catalog.spec.ts` | C5 unit half; `toModelNode`, `isDrifted` |
| 3 | `domain/providers.ts` | `src/domain/providers.ts`, `test/domain/providers.spec.ts` | C4, C6 pure half, C16 ordering |
| 4 | `domain/keyGroups.ts` | `src/domain/keyGroups.ts`, `test/domain/keyGroups.spec.ts` | C1 pure half; `nextFreeSuffix` |
| 5 | `adapters/modelsJson.ts` + fixture | `src/adapters/modelsJson.ts`, `test/adapters/modelsJson.spec.ts`, `test/fixtures/models.pmm-and-unknown.json` | C6 byte-identical round trip |
| 6 | `adapters/registrar.ts` | `src/adapters/registrar.ts`, `test/adapters/registrar.spec.ts` | built-in skip, unregister removed |
| 7 | `adapters/catalogImporters.ts` | `src/adapters/catalogImporters.ts`, `test/adapters/catalogImporters.spec.ts` | C2, C3 |
| 8 | `tui/primitives/multiSelectList.ts` | `src/tui/primitives/multiSelectList.ts`, `test/tui/multiSelectList.spec.ts` | `a`/`n`/confirm |
| 9 | Model Manager: provider list + detail | `src/tui/tabs/modelManager.ts`, `test/tui/modelManager.spec.ts` | key map rows reach handlers; `~` drift marker |
| 10 | Model Manager: key-group form, catalog screen, bulk edit, forms | `src/tui/tabs/modelManager/{keyGroupForm,catalogScreen,forms}.ts`, tests | C1 UI, C2 UI, C4 UI, C5 UI |
| 11 | Wire registrar into `index.ts` (factory + `session_start`) | `src/index.ts`, `test/index.spec.ts` | `registerProvider` called per owned provider fixture |

### P2 Failover engine

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 1 | Map Pi Provider contract and stream event shapes (explore) | `.scratch/p2-engine/01-map.md` | `StreamChunk.meaningful` rule written |
| 2 | `domain/failureClass.ts` | src + spec | classification table row by row, C15 |
| 3 | `domain/cooldown.ts` | src + spec | C13, `isExcluded` |
| 4 | `domain/chains.ts` | src + spec | C7 data, C16, `virtualModelNode` |
| 5 | `config/sharedState.ts` | src + spec | C14 CAS, C23 memory mode, lock stale rule |
| 6 | `domain/engine.ts` | src + spec (≤600 lines) | C8–C12, C15, one event per failure |
| 7 | `adapters/failoverProvider.ts` + `Registrar.syncFailover` | src + specs | `getModels` per non-empty chain, `inherit` mapping |
| 8 | Chains tab: list + detail | `src/tui/tabs/chains.ts`, spec | key map, status column |
| 9 | Chains tab: target form, add targets, Same-Model Import preview | `src/tui/tabs/chains/{targetForm,importPreview}.ts`, specs | abort warning, `failover` excluded, C16 preview order |
| 10 | Settings: reset-all count + provider-delete chain list | `src/tui/tabs/settings.ts`, `src/tui/tabs/modelManager.ts`, specs | C7 UI half |
| 11 | Wire state + failover provider into `index.ts` | `src/index.ts`, `test/index.spec.ts` | `registerProvider("failover")` on fixture chain |

### P3 History Log

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 1 | `history/historyLog.ts` | src + spec | C17, malformed-line count, filters |
| 2 | Engine emits events; `manual` on every reset path | `src/domain/engine.ts`, `src/tui/tabs/{chains,settings}.ts`, specs | one event per failure, `manual` on reset |
| 3 | History tab | `src/tui/tabs/history.ts`, spec | C18 |
| 4 | Wire `HistoryLog` into `index.ts`; flush on shutdown | `src/index.ts`, spec | `session_shutdown` flushes |

### P4 Polish and release

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 1 | README | `README.md` | sections listed in `06-roadmap.md` |
| 2 | Pin peer ranges, version `2.0.0`, `files` check | `package.json` | `npm pack --dry-run` lists only `src/`, `README.md`, `LICENSE`, `package.json` |
| 3 | Module size audit and splits | any `src/**` over 400 lines + `03-components.md` | `wc -l` all ≤ 400 |
| 4 | Publish dry-run | none | `npm publish --dry-run` green; publish itself by the user |
