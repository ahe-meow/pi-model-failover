# 03 Components

One row per module. Vocabulary: `CONTEXT.md`. Layer rules: `docs/design/02-architecture.md`. Every module stays under 400 lines; adding a module means adding a section here in the same change.

Shared types live in `src/domain/types.ts` and are referenced below without repeating them:

```ts
export type ApiType = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
export type TargetRef = `${string}/${string}`;                       // provider/modelId
export type ErrorHandlingMode = "smart" | "switch" | "retry";
export type TtftAction = "cooldown-only" | "abort";
export type FailureClass = "cooldown" | "persistent" | "compat-retry";
export type FailoverReason = `http-${number}` | "network" | "ttft-timeout" | "no-progress" | "persistent" | "manual";

export interface CatalogModel { id: string; name?: string; reasoning: boolean; vision: boolean; contextWindow: number; maxTokens: number; defaults: Record<string, unknown>; }
export interface TargetSettings { errorHandlingMode: ErrorHandlingMode; maxRetries: number; reasoningEffort: "inherit" | "minimal" | "low" | "medium" | "high"; modelParameters: Record<string, unknown>; noProgressTimeoutSeconds: number; ttftTimeoutSeconds: number; ttftAction: TtftAction; }
export interface Target extends Partial<TargetSettings> { provider: string; modelId: string; }
export interface Chain { id: string; name: string; targets: Target[]; }
export interface KeyGroup { id: string; prefix: string; template: { baseUrl: string; api: ApiType; headers: Record<string, string> }; createdAt: string; }
export interface Settings extends TargetSettings { listRows: number; }   // reasoningEffort/modelParameters unused at global level
export interface TargetState { consecutiveFailures: number; cooldownLevel: number; cooldownUntil: string | null; manualRecovery: boolean; lastFailure: { ts: string; reason: FailoverReason } | null; }
export interface FailoverEvent { ts: string; sessionId: string; requestSeq: number; from: TargetRef; to: TargetRef | null; reason: FailoverReason; elapsedMs: number; }

// models.json shapes (Pi's), unknown fields preserved via index signature
export interface ModelNode { id: string; name?: string; api?: ApiType; baseUrl?: string; reasoning: boolean; thinkingLevelMap?: Record<string, string>; input: ("text" | "image")[]; contextWindow: number; maxTokens: number; cost: { input: number; output: number; cacheRead: number; cacheWrite: number }; headers?: Record<string, string>; compat?: Record<string, unknown>; [k: string]: unknown; }
export interface ProviderNode { name: string; baseUrl: string; api: ApiType; apiKey?: string; authHeader?: string; headers?: Record<string, string>; compat?: Record<string, unknown>; modelOverrides?: Record<string, unknown>; models: ModelNode[]; piModelFailover?: { group: string | null; costMultiplier: number }; piModelManager?: { managed: boolean }; [k: string]: unknown; }
export type ModelsJson = { providers: Record<string, ProviderNode>; [k: string]: unknown };
```

Injected dependencies (`src/domain/ports.ts`):

```ts
export interface FileSystem { readText(p: string): Promise<string | null>; writeAtomic(p: string, data: string, mode: number): Promise<void>; mkdir(p: string, mode: number): Promise<void>; tryCreateExclusive(p: string): Promise<boolean>; unlink(p: string): Promise<void>; mtime(p: string): Promise<number | null>; }
export interface Clock { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void>; }
export type Fetch = typeof globalThis.fetch;
```

---

## config/

### `config/writeQueue.ts`

Responsibility: serialize every file write in the process.

```ts
export class WriteQueue { enqueue<T>(task: () => Promise<T>): Promise<T>; pending(): number; }
```

Dependencies: none. Tests assert: tasks run in enqueue order; a rejected task rejects its caller and does not stop later tasks; `pending()` drops to 0.

### `config/jsonStore.ts`

Responsibility: load and save one versioned JSON file with fail-open and unknown-field preservation.

```ts
export interface StoreOptions<T> { path: string; version: number; defaults: () => T; migrations: Record<number, (raw: unknown) => unknown>; mode?: number; }
export class JsonStore<T extends { version: number }> {
  constructor(fs: FileSystem, queue: WriteQueue, opts: StoreOptions<T>);
  load(): Promise<{ value: T; status: "ok" | "missing" | "corrupt" | "newer-version" | "migrated" }>;
  save(value: T): Promise<void>;                     // through queue, tmp+rename, 0600
}
```

Dependencies: `FileSystem`, `WriteQueue`. Tests assert: missing file → defaults; malformed JSON → defaults, status `corrupt`, file untouched; higher `version` → status `newer-version`, save refused; lower version runs migrations in order; extra top-level fields survive load+save (C6 pattern, C21 mode).

### `config/configStore.ts`

Responsibility: typed access to `config.json` (settings, catalog, key groups, chains).

```ts
export interface ConfigFile { version: 1; settings: Settings; catalog: CatalogModel[]; keyGroups: KeyGroup[]; chains: Chain[]; }
export const DEFAULT_SETTINGS: Settings;             // listRows 7, ttft 60/cooldown-only, maxRetries 5, smart, noProgress 90
export class ConfigStore {
  static open(fs: FileSystem, queue: WriteQueue, dir: string): Promise<ConfigStore>;
  get(): ConfigFile;                                  // in-memory snapshot
  update(fn: (c: ConfigFile) => void): Promise<void>; // mutate copy, validate, save
  onChange(cb: () => void): () => void;
}
```

Dependencies: `JsonStore`. Tests assert: defaults match `DEFAULT_SETTINGS`; `listRows` outside 5–20 is rejected by `update`; `onChange` fires once per `update`.

### `config/sharedState.ts`

Responsibility: cross-process Target runtime state with lock + CAS; memory mode on corruption.

```ts
export class SharedState {
  static open(fs: FileSystem, clock: Clock, queue: WriteQueue, dir: string): Promise<SharedState>;
  read(): Promise<Record<TargetRef, TargetState>>;    // fresh from disk unless memory mode
  update(fn: (targets: Record<TargetRef, TargetState>) => void): Promise<void>;
  isMemoryMode(): boolean;
  flush(): Promise<void>;
}
```

Dependencies: `FileSystem`, `Clock`, `WriteQueue`. Tests assert: lock acquired with exclusive create, released after write; stale lock (>10 s) replaced; second `update` sees `revision` bumped by a simulated other process and applies on top of its data (C14); corrupt file → memory mode, one status, file bytes unchanged (C23).

### `config/migrations.ts`

Responsibility: ordered migration functions for `config.json` and `state.json`.

```ts
export const CONFIG_VERSION = 1; export const STATE_VERSION = 1;
export const configMigrations: Record<number, (raw: unknown) => unknown>;  // {} in v1
export const stateMigrations: Record<number, (raw: unknown) => unknown>;   // {} in v1
```

Tests assert: every integer in `1..VERSION-1` has an entry (vacuously true in v1).

---

## domain/

### `domain/redact.ts`

```ts
export function redactSecret(value: string): string;  // "sk-…abcd"; <8 chars → "…"; "$ENV"/"${ENV}" refs returned unchanged
export function redactProvider(p: ProviderNode): ProviderNode;  // copy with apiKey and header values matching /key|token|auth/i redacted
```

Tests assert: exact outputs for 4-, 8-, 40-char inputs; env refs untouched; header `Authorization` redacted, `X-Team` kept (C22).

### `domain/catalog.ts`

Responsibility: Catalog CRUD and copy/sync semantics (ADR-0003).

```ts
export const CATALOG_DEFAULTS: Omit<CatalogModel, "id">;  // reasoning true, vision true, contextWindow 272000, maxTokens 128000, {}
export function upsertCatalogModel(catalog: CatalogModel[], m: CatalogModel): CatalogModel[];
export function removeCatalogModel(catalog: CatalogModel[], id: string): CatalogModel[];
export function toModelNode(m: CatalogModel): ModelNode;              // copy; cost zeros; input from vision
export function syncAttributes(node: ModelNode, m: CatalogModel): ModelNode; // overwrites reasoning,input,contextWindow,maxTokens; keeps rest
export function isDrifted(node: ModelNode, m: CatalogModel): boolean;
```

Tests assert: upsert replaces by id; `toModelNode` maps `vision:true` → `input: ["text","image"]`; `syncAttributes` leaves `cost`, `headers`, `compat`, unknown fields identical (C5); `isDrifted` false right after copy.

### `domain/providers.ts`

Responsibility: pure edits to `ModelsJson` providers.

```ts
export function listProviders(m: ModelsJson): Array<{ id: string; node: ProviderNode; owned: boolean; multiplier: number | null }>;
export function upsertProvider(m: ModelsJson, id: string, node: ProviderNode): ModelsJson;
export function renameProvider(m: ModelsJson, id: string, name: string): ModelsJson;
export function deleteProvider(m: ModelsJson, id: string): ModelsJson; // P1 data-half operation; changes only ModelsJson.providers
export function addModelToProviders(m: ModelsJson, ids: string[], node: ModelNode): ModelsJson;   // skip if modelId exists
export function removeModel(m: ModelsJson, providerId: string, modelId: string): ModelsJson;
export function setMultiplier(m: ModelsJson, id: string, multiplier: number): ModelsJson;        // creates marker with group null if absent
export function providersWithModel(
  models: ModelsJson,
  modelId: string,
): string[];
// Sort owned providers with numeric costMultiplier first by multiplier and then
// provider id; append unowned providers in provider-id order. The fixture order
// for ids b, a, c with multipliers 1.00, 0.10, 0.10 is a, c, b.
```

Sort owned providers with a numeric costMultiplier first by multiplier and then provider id; append unowned providers in provider-id order.

P1 provider deletion changes only `ModelsJson.providers`; chain target cleanup is the P2 `domain/chains.ts` handoff. `deleteProvider` never inspects or mutates chains.

Tests assert: functions return new objects and never mutate input; unknown fields survive every function (C6); `addModelToProviders` over 5 ids yields 5 identical nodes (C4); `providersWithModel` order `a, c, b` for the C16 fixture.

### `domain/keyGroups.ts`

```ts
export interface KeyEntry {
  key: string;
  multiplier?: number;
}

export function createKeyGroup(input: {
  prefix: string;
  template: KeyGroup["template"];
  keys: KeyEntry[];
  now: string;
  id: string;
  existingIds?: readonly string[];
}): {
  group: KeyGroup;
  providers: Record<string, ProviderNode>;
};

export function nextFreeSuffix(existing: string[], prefix: string): number;
```

`nextFreeSuffix(existing, prefix)` returns the smallest available positive suffix: the smallest positive integer `n` for which `${prefix}-${n}` is absent from `existing`. It does not mutate `existing`. `createKeyGroup` defaults `existingIds` to `[]`, starts at `nextFreeSuffix(existingIds, prefix)`, and skips both occupied ids and ids allocated earlier in the batch.

Tests assert: 20 keys → ids `p-1..p-20`, each with marker `{ group, costMultiplier }` (C1); default multiplier 1; `nextFreeSuffix` skips taken ids so a second batch continues numbering.

### `domain/chains.ts`

```ts
export function upsertChain(chains: Chain[], c: Chain): Chain[];
export function removeChain(chains: Chain[], id: string): Chain[];
export function moveTarget(c: Chain, index: number, delta: -1 | 1): Chain;
export function addTargets(c: Chain, refs: TargetRef[]): Chain;              // dedupe, reject provider "failover"
export function removeTarget(c: Chain, ref: TargetRef): Chain;
export function chainsReferencing(chains: Chain[], providerId: string): Chain[];
export function dropProvider(chains: Chain[], providerId: string): Chain[]; // P2 chain-side cleanup for chain-aware provider deletion
export function sameModelImport(c: Chain, m: ModelsJson, modelId: string): Chain;   // uses providersWithModel
export function virtualModelNode(c: Chain, m: ModelsJson): ModelNode | null;      // from first target; null if empty or target missing
export function resolveTargetSettings(t: Target, s: Settings): TargetSettings;
```

Tests assert: `addTargets` rejects `failover/x`; P2 `dropProvider` tests remove only matching targets (C7 data half); `virtualModelNode` inherits `contextWindow`, `reasoning`, `input` and returns null for empty chain; `sameModelImport` order (C16).

### `domain/failureClass.ts`

```ts
export interface FailureInput { status?: number; code?: string; body?: string; timer?: "ttft" | "no-progress"; sentParams: string[]; }
export function classify(e: FailureInput): { cls: FailureClass; reason: FailoverReason; offendingParam?: string };
```

Tests assert: table in `02-architecture.md` row by row; 400 body `"Unknown parameter: reasoning_effort"` → `compat-retry` with `offendingParam` (C15); 429 with `insufficient_quota` → persistent.

### `domain/cooldown.ts`

```ts
export const LADDER_MS = [60_000, 300_000, 900_000, 3_600_000];
export function cooldownFor(level: number): number;                   // level ≥ 4 → 3_600_000
export function backoffMs(attempt: number): number;                   // min(1000 * 2^attempt, 60_000)
export function applyFailure(s: TargetState, reason: FailoverReason, now: number): TargetState;
export function applySuccess(s: TargetState): TargetState;
export function applyManualRecovery(s: TargetState, now: number, reason: FailoverReason): TargetState;
export function reset(): TargetState;
export function isExcluded(s: TargetState | undefined, now: number): boolean;
```

Tests assert: C13 ladder; level 5 stays at 60 min; `applySuccess` → level 0, `cooldownUntil` null; `manualRecovery` excluded regardless of time (C9 data half).

### `domain/engine.ts`

Responsibility: the per-request decision tree (Flow 2) over an abstract stream source.

```ts
export interface Attempt { events: AsyncIterable<StreamChunk>; abort(): void }
export interface StreamChunk { meaningful: boolean; payload: unknown; done?: boolean }
export interface EngineDeps {
  send(target: TargetRef, settings: TargetSettings, stripped: string[], signal: AbortSignal): Promise<Attempt>;  // throws FailureInput-shaped errors
  state: { read(): Promise<Record<TargetRef, TargetState>>; update(fn: (t: Record<TargetRef, TargetState>) => void): Promise<void> };
  history: { append(e: FailoverEvent): Promise<void> };
  clock: Clock; sessionId: string;
}
export function runChain(deps: EngineDeps, chain: Chain, settings: Settings, requestSeq: number, signal: AbortSignal): AsyncIterable<unknown>;
```

`runChain` yields payloads from the winning attempt only; an aborted attempt's partial payloads are discarded. Dependencies: `failureClass`, `cooldown`, `chains`. Tests (fake `send`, fake clock) assert: C8, C9, C10, C11, C12, C15; all-excluded chain retries once ignoring cooldown; `switch` mode never retries; `retry` mode sleeps `backoffMs` and stops at `maxRetries`; every failure appends exactly one event with correct `from`/`to`.

---

## adapters/

### `adapters/modelsJson.ts`

```ts
export class ModelsJsonFile {
  constructor(fs: FileSystem, queue: WriteQueue, path: string);
  read(): Promise<ModelsJson>;                                   // {} providers if missing; throws on malformed with redacted message
  update(fn: (m: ModelsJson) => ModelsJson): Promise<ModelsJson>; // fresh read inside queue, tmp+rename, keep existing file mode
}
```

Tests assert: round trip of a fixture with `piModelManager` markers and nested unknown fields is byte-identical apart from the edited name (C6); two concurrent `update` calls both apply.

### `adapters/registrar.ts`

Responsibility: mirror owned providers into Pi at runtime. Failover registration is deferred to P2.

```ts
export interface PiRegistrar { registerProvider(id: string, cfg: unknown): void; unregisterProvider(id: string): void; isBuiltin(id: string): boolean; }
export class Registrar {
  constructor(pi: PiRegistrar, notify: (msg: string) => void);
  syncOwned(models: ModelsJson): void;
}
```

P1 `Registrar` exposes `syncOwned(models)` only. It tracks the ids it previously registered as owned. `syncOwned` registers current owned providers, unregisters previously owned ids that disappeared, and skips any id reported as built in. A skipped built-in produces one notification and never calls registration. Registration receives the raw provider configuration only at this adapter boundary; it is never passed to UI rendering or user-visible reporting.

`syncFailover` begins in P2 and is intentionally absent from the P1 implementation. The `adapters/failoverProvider.ts` contract also begins in P2. Any source interface that includes either P2 surface must keep it unimplemented until the P2 Provider survey is complete.

Tests assert: built-in id skipped with one notification; removed provider unregistered. P2 tests cover failover registration separately.

### `adapters/failoverProvider.ts` (P2)

This adapter begins in P2; it is not a P1 contract or implementation surface. P2 reconciles the installed Pi Provider contract before implementing it.

Responsibility: Pi Provider contract for the reserved `failover` provider, delegating request decisions to `domain/engine.ts`.

```ts
export interface Attempt {
  events: AsyncIterable<StreamChunk>;
  abort(): void;
}
export interface StreamChunk {
  meaningful: boolean;
  payload: unknown;
  done?: boolean;
}
export interface FailureInput {
  status?: number;
  code?: string;
  body?: string;
  timer?: "ttft" | "no-progress";
  sentParams: string[];
}
export interface ModelRegistryLike {
  find(provider: string, modelId: string): Model<Api> | undefined;
  getProvider(provider: string): {
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream;
  } | undefined;
  getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth>;
}
export interface FailoverConfigFactory {
  (chains: Chain[], models: ModelsJson): ProviderConfig;
}
```

`ProviderConfig.streamSimple` consumes and returns Pi's official `AssistantMessageEventStream`, created with `createAssistantMessageEventStream` from `@earendil-works/pi-ai`. The domain engine remains Pi-independent and exposes only `Attempt`/`StreamChunk`; `@earendil-works/pi-ai` is imported only by `src/adapters/failoverProvider.ts`.

The adapter exposes one Virtual Model per non-empty Chain as `failover/<chainId>`, resolves the underlying registry model at request time, delegates attempts to the engine, and forwards only the winning attempt's events. Unknown chains and provider failures use generic redacted errors and never expose credentials or raw response bodies.

`send` resolves `provider/modelId`, applies Target model parameters, maps `reasoningEffort: "inherit"` to the current thinking level, strips rejected compatibility parameters, forwards the attempt signal, and converts Pi events into the domain stream shape. Tests use a fake `ModelRegistryLike` and the official event-stream factory without network access.

### `adapters/catalogImporters.ts`

```ts
export async function fetchEndpointModels(fetch: Fetch, template: { baseUrl: string; apiKey?: string; headers?: Record<string, string> }): Promise<string[]>;  // GET {baseUrl}/v1/models → data[].id
export async function importPiBuiltinCatalog(runtimeFactory: () => Promise<{ getModels(): unknown[] }>): Promise<CatalogModel[]>;
```

Tests assert: 50 ids parsed from a fake response (C2); non-JSON response → typed error; built-in import maps Pi model fields to `CatalogModel` and makes no fetch call (C3).

---

## history/

### `history/historyLog.ts`

```ts
export class HistoryLog {
  static open(fs: FileSystem, queue: WriteQueue, dir: string, cap?: number): Promise<HistoryLog>; // cap 500
  append(e: FailoverEvent): Promise<void>;
  list(filter?: { chain?: string; provider?: string }): Promise<{ events: FailoverEvent[]; dropped: number }>;  // newest first
  flush(): Promise<void>;
}
```

Tests assert: 600 appends → 500 lines, newest kept (C17); malformed line counted in `dropped`; provider filter (C18 data half).

---

## tui/

All project components implement the project's `PiComponent` shape: `{ render(width: number): string[]; handleInput(data: string): void; invalidate?(): void; focused?: boolean }`. `createApp` may omit the optional `invalidate`. The installed `@earendil-works/pi-tui` `Component` contract requires `invalidate(): void`; before passing the app to `ui.custom`, `src/index.ts` supplies a wrapper with a required `invalidate` that delegates to the app's optional method. Rendering uses `truncateToWidth`, `visibleWidth`, `Key`, `matchesKey` from `@earendil-works/pi-tui`. Strings come from `src/strings.ts`.

### `tui/primitives/tabBar.ts`

```ts
export class TabBar { constructor(labels: string[]); active: number; next(): void; prev(): void; set(i: number): void; render(width: number): string; }
```

Tests: `next` wraps; `render` marks active label.

### `tui/primitives/scrollList.ts`

```ts
export interface Row { text: string; marked?: boolean }
export class ScrollList {
  constructor(opts: { listRows: number; multiSelect?: boolean });
  setRows(rows: Row[]): void; selected: number; toggleMark(): void; markedIndices(): number[];
  up(): void; down(): void; pageUp(): void; pageDown(): void; home(): void; end(): void;
  render(width: number): string[];   // exactly listRows lines; last 2 columns scrollbar when rows > listRows
}
```

Tests: output height always `listRows` (C19); scrollbar glyphs present only when overflow; thumb position at top/bottom; selection stays visible after `down` past the window; `toggleMark` only when `multiSelect`.

### `tui/primitives/keyHints.ts`

```ts
export function renderKeyHints(hints: Array<[key: string, label: string]>, width: number): string[]; // 1–2 lines, wraps once, truncates after
```

Tests: fits one line when short; two lines when long; never three.

### `tui/primitives/helpOverlay.ts`

```ts
export class HelpOverlay { constructor(sections: Array<{ title: string; hints: Array<[string, string]> }>); visible: boolean; toggle(): void; render(width: number, height: number): string[]; }
```

Tests: `toggle` flips; render height equals requested height (C20 shape).

### `tui/primitives/form.ts`

```ts
export type Field =
  | { kind: "text"; key: string; label: string; value: string; secret?: boolean; multiline?: boolean }
  | { kind: "number"; key: string; label: string; value: number; min?: number; max?: number; step?: number }
  | { kind: "select"; key: string; label: string; value: string; options: string[]; warning?: Partial<Record<string, string>> }
  | { kind: "multiselect"; key: string; label: string; value: string[]; options: string[] };
export class Form {
  constructor(fields: Field[], onSubmit: (values: Record<string, unknown>) => void, onCancel: () => void);
  render(width: number): string[]; handleInput(data: string): void;
}
```

Tests: `Tab` moves focus; `number` clamps to min/max; `secret` renders via `redactSecret`; `select` shows `warning[value]` under the field when set (the `abort` warning path); `Enter` on last field submits, `Esc` cancels.

### `tui/primitives/multiSelectList.ts`

Thin wrapper: `ScrollList` with `multiSelect: true`, `a` marks all, `n` marks none, `Enter` confirms marked indices. Tests: `a`/`n` toggles; confirm returns indices.

### `tui/app.ts`

Responsibility: root component; owns `TabBar`, active tab component, `HelpOverlay`, `KeyHints`, memory-mode banner; routes `Tab`, `Shift+Tab`, `1`–`4`, `?`, `q`.

```ts
export function createApp(deps: AppDeps): PiComponent;  // AppDeps = every store, adapter, notify, and settings getter; the returned invalidate is optional and is required by pi-tui only after src/index.ts wraps it for ui.custom
```

Tests: `2` switches to Chains; `?` shows overlay and swallows other keys until closed; total render height = header + tabs + listRows + footer for every tab (C19).

### `tui/tabs/modelManager.ts`, `tui/tabs/chains.ts`, `tui/tabs/history.ts`, `tui/tabs/settings.ts`

One module per Tab; each composes primitives and calls `domain/*` functions then `ConfigStore.update` / `ModelsJsonFile.update` / `Registrar.syncOwned` for P1 provider changes. P2 failover synchronization is deferred. Sub-screens that push a module past 400 lines split into `tui/tabs/modelManager/*.ts` (provider detail, key-group form, catalog screen). Screens and key maps: `docs/design/04-ui.md`.

Tests per tab: each key in the key map reaches its handler; destructive actions (delete provider, delete chain, reset all) require the confirmation screen; P1 provider-delete confirmation covers provider removal only; P2 adds chain-aware confirmation naming affected chains, target cleanup, and affected Virtual Model re-registration (C7 UI half); history `r` calls `SharedState.update` with `reset()` and appends a `manual` event (C18 UI half); settings `listRows` bound 5–20.

### `src/strings.ts`

`export const S = { ... } as const;` every user-visible string, including `abortWarning: "Aborting still bills the prompt tokens of the aborted request on most providers/relays."`. Test: no string literal longer than 12 characters containing a space appears in `src/tui/**` outside `strings.ts` (a lint-style test with a regex over the source tree).

### `src/index.ts`

Wiring only (`02-architecture.md`, Runtime wiring). Under 120 lines. Test: integration smoke with fake `pi` object asserts the command and hooks are registered and `registerProvider` runs for one owned provider fixture.
