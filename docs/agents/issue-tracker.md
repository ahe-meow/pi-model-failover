# Issue tracker: Local Markdown

Issues, specs, and phase tasks for this repo live as markdown files in `.scratch/`. There are no GitHub issues.

## Conventions

- One directory per phase or feature: `.scratch/<slug>/`. Phase slugs: `p0-shell`, `p1-model-manager`, `p2-engine`, `p3-history`, `p4-release`.
- The phase spec is the matching section of `docs/design/06-roadmap.md`; a feature that is not a phase gets `.scratch/<slug>/spec.md`.
- Implementation tasks are one file per task at `.scratch/<slug>/issues/<NN>-<slug>.md`, numbered from `01`. Never a single combined tasks file.
- Each task file starts with `Status: open | claimed | done | blocked`, then `Allowed edit surfaces:` (exact repository-relative paths), then `Acceptance:` (test names or commands), then the body.
- Facts pulled from branch `V1` are recorded with the exact `git -c safe.directory='/storage/emulated/0/AI Workplace/pi-model-auto-switch' show V1:<path>` command used.
- Comments and handoff evidence (RED/GREEN output, verify results) append to the bottom under `## Comments`.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<slug>/issues/` (creating directories as needed) with the header lines above.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The parent normally passes the path directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` with Notes, Decisions-so-far, and Fog sections.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; lowest number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under `## Answer`, set `Status: resolved`, then append a pointer (gist + path) to Decisions-so-far in `map.md`.
