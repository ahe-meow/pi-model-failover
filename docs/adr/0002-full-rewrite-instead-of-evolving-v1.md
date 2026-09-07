---
status: accepted
---

# Full rewrite instead of evolving V1

V1 (branch `V1`) works but lives in four files of 1300 to 2600 lines each. We start `main` empty and rewrite from the design docs, using V1 as a read-only reference for behavior only.

## Context

V1 module sizes: `index.ts` 1671 lines, `provider.ts` 1766, `shared-state.ts` 2616, `tui.ts` 1344. Failure classification, cooldown math, shared-state file handling, and TUI rendering are interleaved. No module can be tested through a small interface. Adding the Model Manager, catalog, key groups, and TTFT budget to that shape would grow files past 3000 lines.

## Considered options

1. **Full rewrite from design docs, V1 as behavior reference** (chosen).
2. **Incremental extraction from V1.** Each extraction step needs tests that V1 does not have; the first months of work would produce no user-visible change.
3. **Keep V1, bolt on the Model Manager as a second extension.** Two extensions, two config files, and chains that cannot see manager-created providers.

## Decision

- `main` starts with only the design docs. No file from `V1` is copied or checked out.
- V1 semantics that users depend on are preserved by specification, not by code: failure classes, `errorHandlingMode`, `maxRetries`, `reasoningEffort`, `modelParameters`, `noProgressTimeoutSeconds`, the cooldown ladder, and the shared-state file concept.
- Every module targets at most 400 lines and one responsibility (see `docs/design/03-components.md`).
- Tests are written first with vitest for every behavior listed in the design.
- Reading V1 is allowed via `git show V1:<path>` when a fact is missing from the docs. Copying is not.

## Consequences

- P0 through P2 reproduce existing behavior before any new feature ships; users on V1 see nothing new until P1.
- The config file format changes. V1 config is not migrated in v2.0; a user re-creates chains in the new UI. A migration can be an ADR later if demand appears.
- Line-count limits are enforced in review, not by tooling, in v1.
