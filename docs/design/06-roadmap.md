# 06 Roadmap

Five phases. Each closes a set of success criteria from `docs/design/00-goal.md` (`C1`–`C23`). Tasks for the active phase live under `.scratch/<phase>/` (`docs/agents/issue-tracker.md`). P0 tasks are written out in `docs/design/07-plan.md`; later phases get their plan when they start.

## Workflow rules that apply to every phase

- **Single writer.** One `gentle-ai-worker` writes at a time. Its task file names the exact allowed edit surfaces (`src/<layer>/<module>.ts`, `test/<layer>/<module>.spec.ts`, and the `03-components.md` section when the interface changes). Parallel writers only in separate git worktrees the user approved.
- **Mapping before writing.** When a task touches or needs facts from 4 or more files, a `gentle-ai-explore` run maps them first and returns a read-only summary the worker consumes.
- **Verification after every work unit.** `gentle-ai-verify` runs, in order: `npx vitest run <changed spec files>`, `npm test`, `npx tsc --noEmit`, `npx biome check .`. Any red result blocks the next work unit.
- **Review budget.** 400 changed lines per work unit (test lines included). A task estimated above that is split before dispatch.
- **Strict TDD.** Worker handoff records the RED run (failing test output) and the GREEN run per task.
- **Fan-out only where tasks are independent and share no file.** A `SubagentWorkflow` pipeline is justified when three or more tasks write disjoint files and each has a one-command gate (`npx vitest run test/<path>.spec.ts`). Each branch still gets its own edit surface; the pipeline merges by running the full verify step once at the end.
- **Phase gate.** The parent runs the phase acceptance checks, then opens `.scratch/<next-phase>/` before any next-phase task starts.

---

## P0 Shell

Deliverables:

- Package skeleton from `05-skeleton-and-layout.md`: `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.gitignore` additions, `LICENSE`.
- `config/writeQueue.ts`, `config/jsonStore.ts`, `config/configStore.ts`, `config/migrations.ts`, `adapters/nodeFs.ts`, `test/fakes/*`.
- `domain/types.ts`, `domain/ports.ts`, `domain/redact.ts`, `strings.ts`.
- TUI frame: `tui/primitives/{tabBar,scrollList,keyHints,helpOverlay,form,confirm}.ts`, `tui/app.ts` with four tabs where Model Manager, Chains, and History render an empty list and Settings is complete.
- `src/index.ts` registering `/failover` and opening the app in TUI mode; other modes notify and return.

Acceptance:

- `npm run check` green.
- C19, C20, C21 (config.json), C22 (`redactSecret`), and the `listRows` 5–20 bound pass as vitest tests.
- Manual: `pi -e ./src/index.ts`, `/failover`, cycle tabs with `Tab` and `1`–`4`, change `listRows` to 12 and see 12 rows on every tab, `?` opens and closes help.

Subagent design:

- Task 1 (skeleton) and Task 2 (`writeQueue` + `jsonStore`) run sequentially by one worker; everything depends on them.
- Tasks 3–6 (`redact`, `configStore`, `tabBar`+`keyHints`, `scrollList`) are disjoint and may fan out through a `SubagentWorkflow` with gate `npx vitest run test/<layer>/<module>.spec.ts` each. Fan-out is optional; sequential is acceptable when the user prefers fewer agents.
- Tasks 7–10 (`form`+`confirm`, `helpOverlay`, `app`+`settings` tab, `index.ts`) run sequentially because they compose the earlier primitives.
- `gentle-ai-verify` after every task.

---

## P1 Model Manager

Deliverables:

- `domain/catalog.ts`, `domain/providers.ts`, `domain/keyGroups.ts`.
- `adapters/modelsJson.ts`, `adapters/registrar.ts`, `adapters/catalogImporters.ts`.
- `tui/primitives/multiSelectList.ts`; `tui/tabs/modelManager.ts` with provider list, provider detail, add/edit provider form, key-group form, catalog screen, bulk edit, delete confirmation; registration of owned providers at factory time and on `session_start`.

Acceptance:

- C1–C6 pass as vitest tests. C7's data half (`dropProvider`) passes; its UI half waits for P2 chains.
- `test/fixtures/models.pmm-and-unknown.json` round-trips byte-identical except the edited field.
- Manual: batch-add 3 keys against a real relay, see 3 providers in Pi's `/model` without restarting Pi; import 5 models from `/v1/models`; sync attributes.

Subagent design:

- `gentle-ai-explore` first: map Pi's `models.json` loader, `ModelRegistry.find/hasConfiguredAuth/refresh`, and `ModelRuntime.create` signatures from the installed `@earendil-works/pi-coding-agent` (read-only, returns exact types).
- Fan-out candidates (disjoint files, one gate each): `catalog.ts`, `providers.ts`, `keyGroups.ts`; then a second fan-out for the three importers inside `catalogImporters.ts` is **not** justified (same file); instead one worker for `catalogImporters.ts` and one for `modelsJson.ts`+`registrar.ts`.
- Model Manager tab is the largest unit; split into `modelManager.ts` (list + detail) and `modelManager/{keyGroupForm,catalogScreen,forms}.ts`, one worker each in sequence, each under 400 changed lines.

---

## P2 Failover engine

Deliverables:

- `domain/chains.ts`, `domain/failureClass.ts`, `domain/cooldown.ts`, `domain/engine.ts`.
- `config/sharedState.ts` (lock + CAS + memory mode).
- `adapters/failoverProvider.ts`; `Registrar.syncFailover`.
- `tui/tabs/chains.ts` with chain list, chain detail, Target settings form with tri-state Server Quality overrides and the disabled-timer warning, add targets, Same-Model Import preview, reset keys; Settings tab gains global Server Quality switches and the shared warning.
- Provider delete confirmation now lists affected chains (C7 UI half).

Acceptance:

- C7–C16 and C23 pass as vitest tests (engine tests use fake `send` and fake clock; shared-state CAS test simulates a second process by editing the file between reads).
- Manual: chain of two providers where the first key is revoked; a request lands on the second provider, History shows `persistent`; with Server Quality enabled, a sleeping relay produces `ttft-timeout` or `no-progress` and follows the Target's retry policy—`smart`/`retry` share `maxRetries` and backoff, while `switch` advances immediately. Cooldown and History are written after retry exhaustion.
- Two terminals running Pi share cooldowns (C14) observed by hand.

Subagent design:

- `gentle-ai-explore`: map Pi's Provider contract (`getModels, filterModels, stream, streamSimple`) and the stream event shapes from the installed package; return exact types for `StreamChunk.meaningful` detection.
- Fan-out (disjoint, one gate each): `failureClass.ts`, `cooldown.ts`, `chains.ts`. Then sequential: `sharedState.ts`, `engine.ts`, `failoverProvider.ts`, chains tab (split into `chains.ts` + `chains/targetForm.ts` + `chains/importPreview.ts`), Settings additions.
- `engine.ts` is the one module allowed a 600-line test file; the test file is its own work unit.

---

## P3 History Log

Deliverables:

- `history/historyLog.ts`; engine wiring appends events; `manual` events on every reset path.
- `tui/tabs/history.ts`: list newest first, detail screen, chain and provider filters, `r` reset, `g` refresh.

Acceptance:

- C17, C18 pass. Existing P2 engine tests now assert one event per failure with `from`/`to`.
- Manual: 600 forced failovers (loop with a dead relay) leave 500 lines; filter by provider; `r` clears a cooldown visible in the Chains tab.

Subagent design: two sequential workers (`historyLog.ts`, then the tab). No fan-out.

---

## P4 Polish and release

Deliverables:

- `README.md`: install, `/failover` tour with the mockups from `04-ui.md`, coexistence note (ADR-0001), Server Quality switches and retry semantics, file locations, redaction policy.
- Peer dependency ranges pinned to the installed Pi major; `version` set to `2.0.0`.
- `npm pack --dry-run` shows only `src/`, `README.md`, `LICENSE`, `package.json`.
- `npm publish --dry-run` succeeds (publish itself is a user action).
- Every module under 400 lines: `wc -l src/**/*.ts` reviewed; a module over the limit is split in this phase.

Acceptance: `npm run check` green; both dry-runs green; README reviewed by the user.

Subagent design: one worker for `README.md` (edit surface `README.md` only), `gentle-ai-verify` for the dry-runs (authorized commands: `npm pack --dry-run`, `npm publish --dry-run`). Publishing is done by the user.

---

## Criteria to phase map

| Phase | Criteria |
| --- | --- |
| P0 | C19, C20, C21 (config.json), C22 |
| P1 | C1, C2, C3, C4, C5, C6, C7 (data half), C21 (models.json mode unchanged) |
| P2 | C7 (UI half), C8, C9, C10, C11, C12, C13, C14, C15, C16, C21 (state.json), C23 |
| P3 | C17, C18, C21 (history.jsonl) |
| P4 | release checks only |
