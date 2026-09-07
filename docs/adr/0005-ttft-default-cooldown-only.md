---
status: accepted
---

# TTFT timeout defaults to cooldown-only, not abort

When a Target exceeds its TTFT Budget (default 60 s), the default action lets the request finish and only marks the Target for cooldown so the next request switches. Aborting is available as an opt-in per-target setting with a billing warning in the UI.

## Context

Slow first tokens are the most common complaint about relays. The obvious fix is to cancel and move on. Most providers and relays bill the prompt tokens of a cancelled request; a 150k-token context aborted three times in a row costs three full prompts and produces nothing. In `smart` mode the request usually completes a few seconds late, and the cooldown still steers later requests away.

## Considered options

1. **Default `cooldown-only`, opt-in `abort` with warning** (chosen).
2. **Default `abort`.** Fast recovery, silent triple billing on large contexts.
3. **No TTFT budget; rely on No-Progress Budget only.** No-progress starts counting after the first delta, so a target that never sends anything is caught only by the network timeout, which can be minutes.

## Decision

- New Target settings: `ttftTimeoutSeconds` (default 60, `0` disables) and `ttftAction: cooldown-only | abort` (default `cooldown-only`). Global defaults for both live in the Settings tab.
- `cooldown-only`: the request continues; when the budget expires the engine records a Failover Event with `reason: ttft-timeout` and raises the Target's Cooldown Level once the request ends, regardless of its outcome.
- `abort`: the engine cancels the request through its `AbortSignal`, records the event, raises the Cooldown Level, and tries the next Target within the same request.
- The Settings and Target forms show this text next to `abort`, verbatim: "Aborting still bills the prompt tokens of the aborted request on most providers/relays."
- TTFT is measured from request send to the first delta that carries text, tool-call, or thinking content. Empty keep-alive chunks do not count.

## Consequences

- With the default, the first slow request per Target is slow. Users who prefer speed over cost flip to `abort` per Target or globally.
- The `abort` path is the only place the engine cancels a stream mid-flight; it needs its own tests for partial-output handling (the aborted partial text is discarded and never surfaced to Pi).
