---
status: accepted
---

# Catalog models are copied into providers, not referenced

Adding a Catalog Model to a Provider copies the full definition into the Provider Model. Later edits to the Catalog Model do not propagate; an explicit bulk action "Sync attributes from catalog" pushes values on demand.

## Context

Pi reads `models.json` as plain data: every model node must carry `contextWindow`, `maxTokens`, `reasoning`, `input`, `cost`. Pi has no notion of a catalog. A live link would require us to resolve references on every write and to rewrite every Provider Model whenever a Catalog Model changes, which also overwrites per-provider tweaks (a relay exposing a smaller context window, for example).

## Considered options

1. **Copy on add, explicit sync action** (chosen).
2. **Live reference: Provider Model stores `catalogRef`, writer expands on save.** Every catalog edit becomes a models.json rewrite; per-provider overrides need a second layer of fields; PMM and hand edits to the same node are lost on the next expansion.
3. **No catalog: type attributes per provider every time.** Twenty providers times five models means one hundred forms.

## Decision

- Catalog Model fields: `{ id, name?, reasoning, vision, contextWindow, maxTokens, defaults }` where `defaults` holds model parameter defaults.
- Adding to a Provider copies all fields into a new Provider Model. No back-reference is stored.
- Editing a Catalog Model affects only future copies.
- "Sync attributes from catalog" is a Model Manager action over a multi-selection of Provider Models. It matches by model id and overwrites `reasoning`, `input`, `contextWindow`, `maxTokens`, and `defaults`, leaving `cost`, `headers`, `compat`, and unknown fields untouched.
- The Catalog is seeded three ways: fetch `GET {baseUrl}/v1/models` and multi-select ids (attributes take conservative defaults), manual entry, and import from Pi's built-in catalog via `ModelRuntime.create({ credentials: emptyStore, modelsPath: null, allowModelNetwork: false }).getModels()`. The package ships no static model list.

## Consequences

- Provider Models can drift from the Catalog. The Model Manager shows a `~` marker next to a Provider Model whose attributes differ from the Catalog Model with the same id, so drift is visible.
- The Catalog can be deleted without breaking any Provider.
- `/v1/models` gives ids only; a user imports with defaults (`reasoning: true`, `vision: true`, `contextWindow: 272000`, `maxTokens: 128000`) and edits afterwards.
