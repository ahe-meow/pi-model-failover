# 00 Goal

Vocabulary: `CONTEXT.md` at the repo root. Decisions: `docs/adr/`.

## Goal

`pi-model-failover` is a Pi coding-agent extension that lets a user manage many providers and models in bulk, group them into ordered failover chains that Pi sees as ordinary models, and keep working when a target fails or stalls. The `/failover` command opens one tabbed TUI: Model Manager, Failover Chains, History Log, Settings.

The user we design for runs one model through several relays and API keys, wants the cheapest working one first, and does not want to babysit rate limits.

## Success criteria

Each criterion has a stable id `C1` to `C23`. Tests quote the id in their name (`it("C13: cooldown ladder 1/5/15/60")`); the roadmap lists which phase closes each one.

### Model Manager

- **C1** Batch key form: 20 keys pasted into one form produce 20 providers `<prefix>-1` to `<prefix>-20` in `models.json` in one write, each with the Ownership Marker and the given multiplier.
- **C2** Catalog import from `GET {baseUrl}/v1/models`: 50 returned ids appear in a multi-select list; confirming 10 of them creates exactly 10 Catalog Models.
- **C3** Import from Pi's built-in catalog completes offline (no network calls) and lists at least one model per Pi built-in provider.
- **C4** Adding a Catalog Model to 5 selected providers writes 5 Provider Models with identical attributes in one write.
- **C5** Attribute Sync over 5 selected Provider Models overwrites `reasoning`, `input`, `contextWindow`, `maxTokens` and leaves `cost`, `headers`, `compat`, and unknown fields byte-identical.
- **C6** Round trip: reading a `models.json` that contains PMM markers and unknown fields, changing one provider name, and writing back changes only that name.
- **C7** Deleting a provider referenced by 3 chains shows a confirmation naming the 3 chains; confirming removes those Targets and re-registers the affected Virtual Models.

### Failover engine

- **C8** A Chain with Targets A, B, C where A returns HTTP 503: the request completes on B within the same request, A gets Cooldown Level 1 (1 minute), and one Failover Event with `reason: http-503` is appended.
- **C9** A returns 401: A enters Manual Recovery, the request completes on B, and A is skipped on every later request until the user presses `r` on it.
- **C10** A sends no delta for 60 s with `ttftAction: cooldown-only`: the request finishes on A, an event with `reason: ttft-timeout` is logged, and the next request starts on B.
- **C11** Same scenario with `ttftAction: abort`: the request is cancelled at 60 s and completes on B within the same request.
- **C12** A sends deltas then goes silent for 90 s: `reason: no-progress`, request continues on B.
- **C13** Consecutive failures on A raise Cooldown Level 1, 2, 3, 4 with cooldowns 1, 5, 15, 60 minutes; a fifth failure stays at 60 minutes; one success resets to level 0.
- **C14** Two Pi sessions share one `state.json`: a cooldown set in session 1 is honored by session 2 on its next request.
- **C15** A request parameter rejection (`reasoning_effort` unknown, for example) is retried without the parameter and raises no Cooldown Level.
- **C16** Same-Model Import for model `m` over providers with multipliers `1.00`, `0.10`, `0.10` and names `b`, `a`, `c` yields the Target order `a, c, b`.

### History Log

- **C17** After 600 events, `history.jsonl` holds exactly the newest 500.
- **C18** History tab lists newest first; filtering by provider hides events from other providers; `r` on a row resets that Target and the row shows `reset` on the next render.

### UI

- **C19** With `listRows = 7`, every list on every tab shows 7 data rows plus fixed header, tab bar, and footer lines; a scrollbar appears when a list has more than 7 items.
- **C20** `?` on any tab shows the help overlay; `?` or `Esc` hides it.

### Storage and secrets

- **C21** `config.json`, `state.json`, `history.jsonl` are created with mode `0600`.
- **C22** Any API key rendered in the TUI, the history, notifications, or logs appears as `sk-…abcd` (first 3 characters, ellipsis, last 4).
- **C23** A corrupted `state.json` puts the engine in in-memory mode, shows one notification, and leaves the file untouched.

## Non-goals for v1

- No internationalization. English only; strings live in `src/strings.ts` so a later i18n pass has one seam.
- No cost accounting or spend reports. Cost Multiplier is a sort key (ADR-0004).
- No proxy or header profiles beyond per-provider `headers`.
- No migration of V1 config (ADR-0002).
- No editing of PMM's marker; we read it and leave it in place.
- No per-request model routing by content or token count. Chains are order-only.
- No web or non-TUI interface. `ctx.mode` must be `tui`; otherwise `/failover` notifies and returns.
