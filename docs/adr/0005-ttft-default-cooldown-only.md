---
status: superseded
superseded_by: v2-server-quality-contract
---

# Server Quality switches replace the cooldown-only TTFT action

The v2 contract replaces the earlier `ttftAction: cooldown-only | abort` design. The old decision remains historical context: cancelling a stream can incur prompt charges, so timeout behavior must be explicit and bounded by the request retry policy rather than silently discarding work.

## Decision

- Global settings store `serverQuality: { enabled, ttft, noProgress }` alongside the TTFT and no-progress timeout values.
- A Target may override each Server Quality field with `inherit`, `on`, or `off`. The effective policy is resolved once at request start, so settings changes affect later requests, not an in-flight request.
- A disabled signal starts no timer. An enabled TTFT or no-progress timer failure is classified as `server-quality` with the display reason `ttft-timeout` or `no-progress`.
- In `retry` mode, and for Server Quality failures in `smart` mode, timer failures use the same `maxRetries` counter and exponential backoff as other retryable failures. `switch` advances immediately.
- Cooldown state and one History event are written only after the shared retry budget is exhausted, except that `switch` records immediately. Changing Targets resets the request retry counter.

## Migration

Config version 2 migrates v1 global and Target `ttftAction` fields by removing the legacy fields and letting Targets inherit the migrated global Server Quality defaults. Unknown configuration fields remain intact.

## Consequences

The engine no longer has a pending-cooldown completion path or a billing warning for an `abort` option. Users choose whether timers are enabled and whether timer failures retry or switch through the shared Server Quality and error-handling controls. Timer failures remain visible in History through their stable display reasons.
