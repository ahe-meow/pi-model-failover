# AGENTS.md

`pi-model-failover`: a Pi coding-agent extension for batch provider management and model failover chains. `main` holds the design docs; source arrives phase by phase (`docs/design/06-roadmap.md`). Branch `V1` is the old implementation, reference only.

## Start here

1. `CONTEXT.md` for vocabulary.
2. `docs/design/00-goal.md` and `01-constraints.md`.
3. The design doc your task names; `03-components.md` for any module contract.

## Rules that bite

- Repo path has spaces and lives on Android shared storage. Quote paths; prefix git with `git -c safe.directory='/storage/emulated/0/AI Workplace/pi-model-auto-switch'`.
- Never copy code from branch `V1` or from `pi-model-manager` (AGPL). Read for behavior only.
- Source modules ≤ 400 lines; user-visible strings only in `src/strings.ts`; secrets always through `redactSecret`.
- Strict TDD with vitest: failing test first, then implementation. Verify with `npm run check`.
- One writer at a time, explicit edit surfaces, 400 changed lines per work unit.
- Commits, pushes, and publishing are the user's actions.

## Agent skills

### Issue tracker

Tasks live as markdown files under `.scratch/<phase>/issues/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root plus `docs/adr/`. See `docs/agents/domain.md`.
