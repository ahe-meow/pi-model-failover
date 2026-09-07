---
status: accepted
---

# Cost multiplier is a sort key and label, never a cost input

Each Provider carries a decimal Cost Multiplier (default `1.00`, shown as `1.00x`). It orders providers in Same-Model Import and labels them in lists. It is never written into Pi's `cost` fields and never used for accounting.

## Context

Users run the same model through several relays priced at different fractions of list price. They want cheap relays first in a Chain. Pi's `cost: { input, output, cacheRead, cacheWrite }` fields are per-million-token prices that Pi shows in its own usage display. Feeding a multiplier into them would require knowing the list price per model, which the Catalog does not track and which changes monthly.

## Considered options

1. **Multiplier as sort key and label only** (chosen).
2. **Multiply Pi `cost` fields on write.** Requires a per-model base price table we would have to maintain; wrong numbers in Pi's usage display are worse than none.
3. **Full cost accounting inside the extension.** Out of scope for v1 (see `docs/design/00-goal.md`, non-goals).

## Decision

- `costMultiplier` lives in the Ownership Marker `piModelFailover.costMultiplier` as a JSON number, two-decimal presentation.
- Same-Model Import sorts Providers by multiplier ascending, ties broken by provider name using code-point comparison (locale-independent).
- Lists show the multiplier as a right-aligned `0.10x` column.
- Batch key creation accepts an optional multiplier per key.
- The models.json writer never derives `cost` values from the multiplier. Pi `cost` fields are copied from the Catalog Model or left as the user typed them.

## Consequences

- A provider without a marker (PMM's, hand-written) has no multiplier; it sorts as `1.00` and shows a blank column.
- Pi's usage display keeps showing whatever `cost` the model node declares. Users who want accurate spend must fill `cost` by hand.
