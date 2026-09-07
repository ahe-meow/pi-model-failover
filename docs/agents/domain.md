# Domain Docs

How agents consume this repo's domain documentation before exploring or changing code.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary. Single-context repo; there is no `CONTEXT-MAP.md`.
- **`docs/adr/`**: read the ADRs that touch the area you are about to work in. Five exist at the time of writing: coexistence with pi-model-manager, full rewrite, catalog copy semantics, cost multiplier scope, TTFT default.
- **`docs/design/`**: `00-goal.md` (success criteria `C1`–`C23`), `01-constraints.md`, `02-architecture.md`, `03-components.md` (module contracts), `04-ui.md`, `05-skeleton-and-layout.md`, `06-roadmap.md`, `07-plan.md`. Read the one your task names; the others are reference.

## File structure

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-coexist-with-pi-model-manager.md
│   └── ...
├── docs/design/
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (a test name, a type, a task title, a UI string), use the term as defined in `CONTEXT.md`. Terms listed under `_Avoid_` are not used in code or docs.

If the concept you need is not in the glossary, either you are inventing language the project does not use (reconsider) or there is a real gap: add the term to `CONTEXT.md` in the same change and say so in your handoff.

## Flag ADR conflicts

If your output contradicts an ADR, say so instead of silently overriding:

> _Contradicts ADR-0003 (catalog copy, not reference); worth reopening because…_

## Component contracts

`docs/design/03-components.md` is the source of truth for module names, exported signatures, and what each unit test asserts. A change to a public signature updates that file in the same work unit.
