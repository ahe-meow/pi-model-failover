---
status: accepted
---

# Coexist with pi-model-manager in the same models.json

Users who install `pi-model-failover` often already run `pi-model-manager` (PMM). Both extensions write providers into Pi's native `~/.pi/agent/models.json`. We chose to share that file, mark our own provider nodes, and let our Model Manager edit any provider in it, including PMM's, without a warning.

## Context

Pi reads one file, `~/.pi/agent/models.json`. PMM marks its provider nodes with `piModelManager: { managed: true }`. If we kept a private provider file, Pi would not see our providers at all; if we refused to touch PMM providers, users could not build chains across their whole configuration.

## Considered options

1. **Shared models.json, marker per extension, edit anything** (chosen).
2. **Shared models.json, refuse to edit nodes owned by PMM.** Blocks the main use case (one chain spanning every provider the user has) and forces users to re-enter providers in our UI.
3. **Private provider store plus runtime-only `pi.registerProvider`.** Providers vanish when the extension is disabled, `/model` history breaks, and PMM cannot see them.

## Decision

- Both extensions may be enabled at once.
- Each writes its own providers into `~/.pi/agent/models.json`.
- Our provider nodes carry `piModelFailover: { group, costMultiplier }`. PMM's carry `piModelManager: { managed: true }`. We read but never write PMM's marker.
- Our Model Manager may edit any provider in the file, marked or not, with no warning dialog.
- Every write preserves fields we do not understand, on the provider node and on each model node.
- At extension factory time we call `pi.registerProvider(providerId, config)` for every provider we own, and re-register on `session_start` so edits take effect without restarting Pi. `pi.unregisterProvider` runs when a provider is deleted. We never register a Pi built-in provider id.
- PMM is AGPL. We reuse its concepts and file conventions, never its code (see ADR-0002).

## Consequences

- A user can break a PMM provider from our UI. We accept this; PMM's own UI can equally edit ours.
- Unknown-field preservation is a hard constraint on the models.json writer and is tested with round-trip fixtures containing foreign keys.
- Both extensions registering the same provider id at runtime is possible if a user hand-copies a node. Pi's last-registration-wins behavior applies; we do not detect it in v1.
