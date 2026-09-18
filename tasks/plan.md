# Implementation Plan: Model Failover UI and Error Improvements

## Overview
Improve the existing pi-model-failover TUI and failover adapter without changing storage formats or unrelated behavior. Independent feature slices may run concurrently only when their allowed files are disjoint; shared files are serialized.

## Architecture Decisions
- Normalize Provider names at the Provider form/domain boundary and retain strict Provider ID validation and rename synchronization.
- Make notification severity explicit so successful Key Group saves use info while validation and persistence failures remain errors.
- Use the existing `PiComponent.invalidate` seam for immediate TUI refresh; do not add a file watcher or second render loop.
- Keep batch key editing state local to the key-entry component and redact secrets outside active editing.
- Carry Catalog selection through the existing Model Manager callback; do not persist UI selection.
- Format final failover errors from structured chain/target/failure data and pass response bodies through existing redaction helpers.
- Reuse `reset()` and `manualEvent()` for whole-chain reset.

## Global Constraints
- Strict RED/GREEN Vitest TDD: each production change follows a focused failing test and a passing focused test.
- Source modules stay at or below 400 lines; test files stay at or below 600 lines; split only when directly required.
- User-visible strings stay in `src/strings.ts`; API keys, Authorization values, and sensitive response bodies never appear in UI, notifications, logs, or tests' rendered output.
- Preserve unknown JSON fields, persistence queues, Chain references, SharedState, selection/filtering/sorting, fixed TUI dimensions, Ctrl+S, and existing redaction.
- No dependency upgrades, storage migrations, History rewrites, commits, pushes, staging, reset, clean, or unrelated file changes.
- One writer per file. Parallel writers are allowed only for disjoint file surfaces. Every worker must receive model `failover/luna:max` and `thinking=max`; task timeout fields remain unset.

## Task 1: Confirm current call paths and worker surfaces
**Description:** Read the relevant source, tests, design contracts, and current worktree. Record the dependency map, shared-file conflict table, baseline commit, and the SDD ledger.
**Acceptance criteria:** The plan, ledger, baseline, and disjoint edit surfaces are recorded; no product source is changed.
**Verification:** `git status --short --branch`; read the ledger and plan.
**Dependencies:** None.
**Files likely touched:** `tasks/plan.md`, `.superpowers/sdd/plan/progress.md`.
**Estimated scope:** Small.

## Task 2: Normalize Provider names
**Description:** Add focused tests and implement add/edit/rename name normalization. Empty names fall back to the Provider ID; non-empty illegal characters become `-`; preserve strict Provider ID validation and reference synchronization.
**Acceptance criteria:** Add, edit, and rename behavior is covered by RED/GREEN tests; raw credentials and unknown fields remain unchanged.
**Verification:** Focused Provider form/domain Vitest tests, then typecheck for touched files.
**Dependencies:** Task 1.
**Files likely touched:** `src/tui/tabs/modelManager/providerForm.ts`, `src/domain/providers.ts` only if needed, `test/tui/modelManager/forms.spec.ts`, focused domain test only if needed.
**Estimated scope:** Medium.

## Task 3: Correct Key Group success feedback
**Description:** Make successful Key Group persistence notify at info severity while validation and persistence failures remain errors. Keep secret redaction.
**Acceptance criteria:** Notification type is observable at the UI boundary; success is not warning; failures retain error severity; no key leaks.
**Verification:** Focused Key Group and entry-point Vitest tests.
**Dependencies:** Task 1.
**Files likely touched:** `src/tui/tabs/modelManager/keyGroupForm.ts`, `src/index.ts` or notification type seam if required, `src/strings.ts`, focused tests.
**Estimated scope:** Medium.

## Task 4: Implement batch API-key row editing
**Description:** Extend the dedicated key editor so Up/Down moves across existing and new rows, Enter commits the current row, Ctrl+U clears the current row, and Ctrl+S saves.
**Acceptance criteria:** Navigation, commit, clear, save, cancel, blank rows, per-line multipliers, fixed-height rendering, and redaction are covered.
**Verification:** Focused KeyGroupForm Vitest tests and typecheck.
**Dependencies:** Task 3; serialize because both tasks touch KeyGroupForm and shared notification strings/tests.
**Files likely touched:** `src/tui/tabs/modelManager/keyGroupForm.ts`, `src/strings.ts`, `test/tui/modelManager/keyGroupForm.spec.ts`.
**Estimated scope:** Medium.

## Task 5: Refresh TUI immediately after saves
**Description:** Wire the existing invalidate path so completed list and Settings saves render current state without unrelated input.
**Acceptance criteria:** Provider, Catalog, Chain, and Settings save flows render current data immediately after awaited save; dimensions, focus, and scroll remain stable.
**Verification:** Focused app, Settings, Model Manager, and Chain Vitest tests; typecheck.
**Dependencies:** Task 1; serialize root callback edits with any Task 3 or Task 7 work touching `src/index.ts`.
**Files likely touched:** `src/tui/app.ts`, `src/index.ts`, relevant focused tests.
**Estimated scope:** Medium.

## Task 6: Select imported Catalog model
**Description:** Carry the first model selected from endpoint import back to Provider detail and select it for the next Provider import action.
**Acceptance criteria:** Endpoint import returns to the Catalog screen with the just-imported model selected; Provider import uses that selection; duplicate, empty, filtered, and visible-index cases remain correct.
**Verification:** Focused CatalogScreen and ModelManager Vitest tests.
**Dependencies:** Task 1.
**Files likely touched:** `src/tui/tabs/modelManager/catalogScreen.ts`, `src/tui/tabs/modelManager.ts` only if required, focused Catalog/ModelManager tests.
**Estimated scope:** Medium.

## Task 7: Report detailed final failover errors
**Description:** Replace the generic terminal failure message with a structured, redacted message containing chain name/ID, final target model, status, and reason.
**Acceptance criteria:** Full failure output covers HTTP, network, retry, timer, and final-target paths; API keys, Authorization, and sensitive bodies are absent; stream and History semantics remain unchanged.
**Verification:** Focused adapter/domain Vitest tests, typecheck, and secret scan for touched output paths.
**Dependencies:** Task 1.
**Files likely touched:** `src/adapters/failoverProvider.ts`, `src/domain/engine.ts` only if required, `src/strings.ts`, adapter/engine tests.
**Estimated scope:** Medium.

## Task 8: Add whole-Chain reset
**Description:** Add list-level `r` confirmation for all Targets in the selected Chain, move list rename to `n`, retain uppercase `R` reset-all, and preserve detail-level `r` single-target reset.
**Acceptance criteria:** All target states reset, one manual History event per Target, confirmation is required, key hints match behavior, and single-target reset remains unchanged.
**Verification:** Focused Chains Vitest tests and typecheck.
**Dependencies:** Task 1; serialize `src/strings.ts` with Task 7.
**Files likely touched:** `src/tui/tabs/chains.ts`, `src/strings.ts`, `test/tui/chains.spec.ts`.
**Estimated scope:** Medium.

## Task 9: Execute parallel collaboration contract
**Description:** Dispatch only disjoint feature lanes concurrently and retain evidence of each worker's exact model, thinking, owned files, status, tests, and report. Review each completed lane before consuming it.
**Acceptance criteria:** No two active writers share a file; all worker dispatches explicitly use `failover/luna:max` and `thinking=max`; no worker publishes changes.
**Verification:** SDD ledger, worker reports, VCS diff, and subagent run metadata.
**Dependencies:** Task 1.
**Files likely touched:** `.superpowers/sdd/plan/progress.md` only.
**Estimated scope:** Small.

## Task 10: Complete full verification
**Description:** Audit every requirement and run all repository gates after implementation and reviews.
**Acceptance criteria:** Focused and full Vitest, TypeScript, Biome, source/test line limits, secret scan, and `git diff --check` pass; unrelated worktree state is preserved; no publication occurs.
**Verification:** Fresh command output and requirement-by-requirement audit.
**Dependencies:** Tasks 2-9.
**Files likely touched:** None unless a directly related test correction is required.
**Estimated scope:** Medium.

## Parallelization Map
After Task 1, Tasks 2, 5, 6, and 7 may run concurrently only while their actual file surfaces remain disjoint. Task 3 and Task 4 are serialized. Task 8 waits for Task 7 if both edit `src/strings.ts`. Root integration edits in `src/index.ts` are serialized with all other root edits. Task 10 runs last.

## Risks and Mitigations
| Risk | Mitigation |
| --- | --- |
| Shared TUI files conflict | One writer per file; serialize overlapping lanes. |
| Error details leak credentials | Reuse `redactFailureBody`; assert raw-key/header absence. |
| Selection regressions under filtering | Test visible-index mapping, duplicate imports, and empty selections. |
| Async save appears stale | Test awaited save followed by immediate render through invalidate seam. |

## Post-Review Repairs and Final Gate
- Task #155: fixed filtered Catalog endpoint import selection by marking the imported model through its full-Catalog source row when the active filter hides it; the regression preserves the filter and verifies the exact target Provider result. Evidence: `/tmp/pmf-catalog-filter-fix-result.md`.
- Task #156/#158: made app and Settings `ConfigStore.onChange` listeners idempotently disposable through the custom TUI component lifecycle, with direct and integration regressions. Evidence: `/tmp/pmf-listener-fix-result.md` and `/tmp/pmf-settings-listener-fix-result.md`.
- Final parent gate: full Vitest passed 54 files/523 tests; TypeScript passed; Biome passed 121 files; source/test line scans, changed-path secret scan, `git diff --check`, and `npm pack --dry-run --ignore-scripts` passed. No staged files, commits, or pushes were made.
