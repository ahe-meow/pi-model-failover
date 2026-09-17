# 02 Architecture

Vocabulary: `CONTEXT.md`. Constraints: `docs/design/01-constraints.md`. Module list: `docs/design/03-components.md`.

## Layers

```text
┌──────────────────────────────────────────────────────────────┐
│ tui/        Tabs, lists, forms. Reads domain state, calls    │
│             domain services. Never touches files or Pi APIs. │
├──────────────────────────────────────────────────────────────┤
│ adapters/   models.json writer, Pi registrar, failover        │
│             provider (Pi Provider contract), catalog fetchers│
├──────────────────────────────────────────────────────────────┤
│ domain/     Catalog, providers, key groups, chains, failure   │
│             classification, cooldown ladder, redaction.      │
│             Pure functions and small stateful services.      │
├──────────────────────────────────────────────────────────────┤
│ config/     Versioned JSON stores: config.json, state.json;   │
│ history/    history.jsonl. Atomic writes, CAS, fail-open.     │
└──────────────────────────────────────────────────────────────┘
```

Imports point downward only. `tui` and `adapters` may both import `domain` and `config`; neither imports the other. `index.ts` is the only module that wires all four layers together and registers with Pi.

## Runtime wiring (`src/index.ts`)

```text
export default async function (pi) {
  1. dir = getAgentDir()/pi-model-failover ; ensure 0700
  2. config  = ConfigStore.load(dir/config.json)      // fail-open to defaults
  3. state   = SharedState.open(dir/state.json)        // fail-open to memory
  4. history = HistoryLog.open(dir/history.jsonl)
  5. models  = ModelsJson.read(getAgentDir()/models.json)
  6. registrar.registerOwned(models)                   // pi.registerProvider per owned provider
  7. registrar.registerFailover(chains, models)        // provider id "failover"
  8. pi.registerCommand("failover", openTui)
  9. pi.on("session_start", () => steps 5–7 again)
 10. pi.on("session_shutdown", () => state.flush(); history.flush())
}
```

The `before_provider_request` hook is not used for routing; the `failover` provider handles routing inside its `stream` implementation because only there does it see the response stream.

## Flow 1: batch-add keys

```text
TUI KeyGroupForm ──submit──▶ domain/keyGroups.createGroup(template, prefix, keys)
                                     │ returns { group, providers[] }  (pure)
                                     ▼
                             config.chains untouched
                             ModelsJson.update(models => mergeProviders(models, providers))
                                     │ one atomic write, unknown fields preserved
                                     ▼
                             registrar.registerOwned(newProviders)   // hot reload
                                     ▼
                             TUI re-reads models, shows N new rows
```

Provider node produced per key:

```json
{
  "name": "relay-3",
  "baseUrl": "https://relay.example/v1",
  "api": "openai-completions",
  "apiKey": "sk-...",
  "headers": { "X-Team": "a" },
  "models": [],
  "piModelFailover": { "group": "kg_01HX...", "costMultiplier": 0.1 }
}
```

Provider id in `models.json` is the object key: `<prefix>-<n>`. Renaming later changes `name` only; the id stays stable so chains keep working.

## Flow 2: request through a chain

Pi calls `failoverProvider.stream(model = failover/coding, request, signal)`.

```text
resolve chain from config and resolve each Target's effective Server Quality policy
  │  snapshot the effective policy at request start; later config edits affect later requests
  ▼
candidates = chain.targets.filter(t => !state.isExcluded(t, now))
  │  excluded = manualRecovery || cooldownUntil > now
  │  if candidates empty and chain has targets → try all in order once (ignore cooldown, honor manualRecovery)
  ▼
for each target in candidates:
    retries = 0
    loop:
      send via registry model for target, with modelParameters + reasoningEffort applied
      start TTFT timer only when Server Quality and TTFT are enabled and the timeout is positive
      ┌─ first meaningful delta arrives ──▶ stop TTFT timer; start/reset no-progress when enabled
      │                                     each meaningful delta resets no-progress timer
      │                                     stream ends OK → state.recordSuccess(target) → return
      │
      └─ timer or provider failure e:
           class = classify(e)
           timer failures have class `server-quality` and reason `ttft-timeout` or `no-progress`
           compatibility-retry → strip offending parameter, retry same target, no penalty, no event
           persistent          → state.setManualRecovery(target), one event(http-<status>), next target
           retryable:
             switch → record one failure and advance immediately
             retry  → if retries < maxRetries, sleep(backoff(retries++)) and retry this target
             smart  → retry Server Quality, network, or HTTP 429 failures with the same shared budget
           after the shared retry budget is exhausted → record one cooldown failure/event and advance
           changing Targets resets retries to zero
all candidates exhausted → throw last error (Pi shows it)


Failure classification (`domain/failureClass.ts`):

| Input | Class | Reason |
| --- | --- | --- |
| Server Quality timer failure | `server-quality` | `ttft-timeout` or `no-progress` |
| HTTP 429, 500–599, `ECONNRESET`/`ENOTFOUND`/`ETIMEDOUT` | cooldown | `http-<status>` or `network` |
| HTTP 401, 403, 404; HTTP 402 or 429 whose body contains `quota`, `insufficient_quota`, or `billing` (case-insensitive) | persistent | the real status: `http-401`, `http-402`, `http-403`, `http-404`, quota/billing `http-429` |
| HTTP 400 with body naming a request parameter we sent (`reasoning_effort`, `temperature`, `max_completion_tokens`, `thinking`) | compatibility-retry | `http-400` |
| Anything else | cooldown | `http-<status>` or `network` |

The class drives behavior; the reason is what the user sees. A persistent failure still enters Manual Recovery while reporting the real status (`http-401`, `http-402`, `http-403`, `http-404`, or quota/billing `http-429`). `reason: "persistent"` stays in the `FailoverReason` union for reading legacy `state.json` and `history.jsonl` records only; the current classifier never emits it.

Cooldown ladder (`domain/cooldown.ts`): level 1 → 1 min, 2 → 5 min, 3 → 15 min, 4+ → 60 min. `recordSuccess` sets level 0. In-request backoff is shared by retryable provider and Server Quality failures: `min(1000 * 2^attempt, 60000)` ms. Cooldown state and History are written after that shared retry budget is exhausted, except for immediate `switch` advancement.

TTFT "meaningful delta" = a chunk carrying text, thinking, or tool-call content. Empty chunks and role-only chunks do not stop the timer. The effective Server Quality policy is resolved once at request start and is not changed by mid-request configuration edits.

If the chain's first target changes (delete, reorder), the Virtual Model's attributes are recomputed and the provider is re-registered. An empty chain is unregistered and hidden from `/model`.

## Flow 3: history write

```text
engine emits FailoverEvent ──▶ HistoryLog.append(event)
                                  │ queued on the process write queue
                                  ▼
                               read file lines (max 500), push, drop oldest beyond 500
                               atomic rewrite (tmp + rename, 0600)
```

Rewrite-on-append is O(500) lines and happens at most once per failure; appending in place would need a separate compaction pass. `HistoryLog.list(filter)` reads the file, parses each line, drops malformed lines with a count, returns newest first.

## Persistence files

All under `getAgentDir()/pi-model-failover/`, mode `0600`, atomic writes, `version` field first.

### config.json (version 2)

```json
{
  "version": 2,
  "settings": {
    "listRows": 7,
    "ttftTimeoutSeconds": 60,
    "serverQuality": { "enabled": true, "ttft": true, "noProgress": true },
    "maxRetries": 5,
    "errorHandlingMode": "smart",
    "noProgressTimeoutSeconds": 90
  },
  "catalog": [],
  "keyGroups": [],
  "chains": [
    { "id": "coding", "name": "Coding", "targets": [
        { "provider": "relay-1", "modelId": "gpt-4.1",
          "errorHandlingMode": "smart", "maxRetries": 5,
          "reasoningEffort": "inherit", "modelParameters": {},
          "noProgressTimeoutSeconds": 90, "ttftTimeoutSeconds": 60,
          "serverQuality": { "ttft": false } }
    ] }
  ]
}
```

`serverQuality` is complete in global settings. Target overrides are optional and tri-state in the UI: `inherit` omits the key, while `on` and `off` persist `true` and `false`. Target fields other than `provider` and `modelId` are optional; missing values fall back to global settings. Key group `template` never stores keys; keys live only in `models.json`.

### state.json (version 1)

```json
{
  "version": 1,
  "revision": 42,
  "targets": {
    "relay-1/gpt-4.1": {
      "consecutiveFailures": 2,
      "cooldownLevel": 2,
      "cooldownUntil": "2025-09-07T12:05:00Z",
      "manualRecovery": false,
      "lastFailure": { "ts": "2025-09-07T12:00:00Z", "reason": "http-503" }
    }
  }
}
```

### history.jsonl

One event per line, newest last in file, capped at 500 lines:

```json
{"ts":"2025-09-07T12:00:00.000Z","sessionId":"s_abc","requestSeq":17,"from":"relay-1/gpt-4.1","to":"relay-2/gpt-4.1","reason":"http-503","elapsedMs":1240,"error":{"status":503,"code":"ETIMEDOUT","body":"upstream …redacted"}}
```

`to` is the next target in the configured Chain, taken from the physical order of `chain.targets`. It is a real target even when cooldown or Manual Recovery excluded it from this request, and `null` only after the final target. `error` is optional: the engine writes it when the provider error carried a `status`, a `code`, or a body, and the body is passed through `redactFailureBody` before it reaches the file. `reason` ∈ `http-<status> | network | ttft-timeout | no-progress | persistent | manual`; `persistent` is legacy-only. `manual` records a user Reset (`from` = target, `to` = null).

### Versioning and migration

- Every store checks `version` on load. Unknown higher version: fail open (defaults or memory), notify once, never write.
- Lower version: run `migrate[from]` functions in `config/migrations.ts` in sequence, then write. The v1-to-v2 migration removes global and Target `ttftAction`, supplies enabled global Server Quality defaults, and preserves unknown fields; Targets then inherit unless they have explicit v2 overrides.
- Fields the current version does not know are preserved in place and written back unchanged.

## Concurrency model

### In-process

One `WriteQueue` (`config/writeQueue.ts`) serializes every write across all four files. Callers `enqueue(() => Promise<void>)`; the queue runs tasks in order and surfaces rejections to the caller. Reads bypass the queue.

### Cross-process (state.json)

Several Pi sessions may run at once. `SharedState.update(fn)`:

1. Acquire `state.lock` with `open(O_CREAT|O_EXCL)`; on `EEXIST` retry every 50 ms up to 2 s; a lock older than 10 s is treated as stale and replaced.
2. Read `state.json`, parse, remember `revision`.
3. Apply `fn(targets)` to a copy.
4. Write `state.json.tmp` with `revision + 1`, fsync, rename.
5. Release the lock (unlink).

If step 2 finds `revision` different from the last value this process saw, the in-memory copy is replaced before `fn` runs, so a cooldown set by another session wins. Every request reads the file before choosing candidates (a 4 KB read per request; no caching in v1).

On parse failure at step 2 the store switches to memory mode: `update` mutates only the in-memory map, `isMemoryMode()` returns true, the TUI shows a banner, and the malformed file is left in place.

### models.json

Written only from the TUI thread through the same `WriteQueue`. Read fresh before every write; the update function receives the parsed object and returns the mutated object. PMM writing at the same moment can lose one side's change; both extensions use tmp+rename so the file is never torn.
