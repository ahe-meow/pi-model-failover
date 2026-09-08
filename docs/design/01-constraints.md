# 01 Constraints

Rules every task, subagent, and reviewer applies. Vocabulary: `CONTEXT.md`.

## Tooling

- TypeScript, ESM (`"type": "module"`), target Node 20 or later (Pi's floor).
- Tests: vitest. Lint and format: Biome. Types: `tsc --noEmit`.
- Commands (created in P0): `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, `npm run check` (all three).
- Local development: `pi -e ./src/index.ts` from the repo root.
- Published as npm package `pi-model-failover`, license MIT.
- Runtime dependencies: `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer dependencies. No other runtime dependency without an ADR.

## Module size and shape

- Hard limit 400 lines per source module, 600 per test file. Split before you cross it.
- One responsibility per module, as listed in `docs/design/03-components.md`. Adding a module means adding its row there in the same change.
- Modules accept their dependencies (file system, clock, fetch, registry) as parameters. No module constructs a dependency it could receive.
- Layers (`docs/design/02-architecture.md`) import downward only: `tui` imports `domain` and `config`; `adapters` import `domain` and `config`; `domain` imports nothing outside `domain` and `config` types.

## Test discipline

- Strict TDD: write the failing vitest test, run it and see it fail, write the minimum implementation, run it and see it pass. Record both runs in the handoff.
- Unit tests use in-memory fakes for file system, clock, fetch, and Pi registry. No test touches `~/.pi`.
- One integration test per persistence file exercises the real `node:fs` API against a temp directory.
- Every success criterion in `docs/design/00-goal.md` maps to at least one test name that quotes its id, for example `it("C13: cooldown ladder 1/5/15/60")`.

## Source provenance

- No code copied from branch `V1` or from `pi-model-manager` (AGPL). Read for behavior, write from the design docs.
- When a V1 fact is needed, cite it in the task file under `.scratch/` with the `git show V1:<path>` command used.

## Secrets

- API keys are stored where Pi stores them: plaintext `apiKey` in `models.json`, or `$ENV` / `${ENV}` references that Pi resolves.
- Every path that renders, logs, notifies, exports, or serializes for display passes keys through `redactSecret()` (`src/domain/redact.ts`), producing `sk-…abcd`: first 3 characters, `…`, last 4. Keys shorter than 8 characters render as `…`.
- Tests for any module that touches a provider assert that its rendered output contains no raw key.

## Files and permissions

- Extension files live in `~/.pi/agent/pi-model-failover/`: `config.json`, `state.json`, `history.jsonl`, `state.lock`. Created with mode `0600`; the directory with `0700`. Resolve the base via `getAgentDir()`, never a hard-coded home path.
- Writes are atomic: write `<file>.tmp`, `fsync`, `rename`.
- `models.json` writes preserve every field the writer does not model, on provider and model nodes. The writer works on parsed JSON objects and mutates only the fields it owns.
- On a malformed file the reader fails open: keep the file, log one redacted notification, continue with defaults (`config.json`) or in-memory mode (`state.json`). Never overwrite a malformed file.

## Concurrency

- One async queue per process serializes all writes to the three extension files and to `models.json`.
- `state.json` uses compare-and-swap on a `revision` field plus `state.lock`; see `docs/design/02-architecture.md`.

## Pi runtime

- The extension runs only inside Pi. No standalone CLI in v1.
- `/failover` requires `ctx.mode === "tui"`; in other modes it notifies "pi-model-failover needs the TUI" and returns.
- Never register a Pi built-in provider id. The registrar checks `ctx.modelRegistry` for built-ins before registering and skips with a notification.
- Provider id `failover` is reserved for Virtual Models and is excluded from every Target picker.

## Subagent and review discipline

- Single writer: at most one `gentle-ai-worker` writes at a time, each with an explicit allowed edit surface. Parallel writers only in separate git worktrees approved by the user.
- Workflow execution uses a progress-based timeout: leave subagent task-timeout fields unset; classify a subagent as timed out only after more than five minutes without observable step progress. Ongoing tool activity or verifiable progress resets the window; inspect workflow status at the threshold before recovery.
- Review budget: 400 changed lines per work unit. Split tasks that would exceed it.
- `gentle-ai-verify` runs `npm test`, `npx tsc --noEmit`, `npx biome check .` after every work unit. A red result blocks the next unit.
- Tasks live as markdown under `.scratch/<phase>/` (see `docs/agents/issue-tracker.md`).

## Development environment

- The repo path contains spaces and lives on Android shared storage (Termux). Every git command needs `git -c safe.directory='/storage/emulated/0/AI Workplace/pi-model-auto-switch'`; quote the path in every shell command.
- Shared storage does not support `chmod`; permission tests assert the requested mode through the fake file system and run the real `0600` check only when `process.platform !== "android"` and the directory supports modes.
- File watching is unreliable on shared storage; nothing depends on `fs.watch`.
