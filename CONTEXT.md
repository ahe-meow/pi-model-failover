# pi-model-failover

A Pi coding-agent extension that manages providers and models in bulk, routes requests through ordered failover chains, and records every switch. This glossary fixes the vocabulary used across `docs/`, `src/`, `test/`, and `.scratch/`.

## Providers and models

**Provider**:
One endpoint entry in Pi's `models.json`: a base URL, an API type, credentials, and a list of Provider Models.
_Avoid_: endpoint, backend, account

**Provider Model**:
A model entry that lives inside one Provider. It is a copy of a Catalog Model, editable independently after the copy.
_Avoid_: model instance, linked model

**Catalog**:
The extension's global list of Catalog Models. It is a source to copy from, never a source of truth for Provider Models.
_Avoid_: registry, model list, model database

**Catalog Model**:
One model definition in the Catalog: id, display name, reasoning flag, vision flag, context window, max tokens, and default parameters.
_Avoid_: template, base model

**Attribute Sync**:
The explicit bulk action that pushes current Catalog Model values into selected Provider Models.
_Avoid_: refresh, relink, update from catalog

**Key Group**:
A set of Providers created together from one endpoint template, one name prefix, and N API keys. Each member keeps the group id and stays individually renamable.
_Avoid_: key pool, key set, batch

**Cost Multiplier**:
A per-Provider decimal (`0.10x`, `1.00x`) the user assigns to express relative price. It orders and labels Providers and nothing else.
_Avoid_: price, cost, rate, weight

**Ownership Marker**:
The `piModelFailover` field on a Provider that records the extension wrote it, with its Key Group and Cost Multiplier.
_Avoid_: tag, managed flag

**API Type**:
One of Pi's four wire protocols: `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`.
_Avoid_: protocol, format, flavor

## Chains

**Chain**:
An ordered list of Targets that Pi sees as one Virtual Model. Requests go to the first Target that is not excluded.
_Avoid_: fallback list, pool, route, group

**Target**:
One `provider/modelId` position inside a Chain, with its own failure-handling settings and runtime state.
_Avoid_: member, hop, candidate, node

**Virtual Model**:
The Pi model `failover/<chainId>` that represents a Chain in Pi's `/model` picker. Its attributes come from the first Target.
_Avoid_: alias, proxy model, meta model

**Same-Model Import**:
The bulk action that fills a Chain with every Provider offering one model id, ordered by Cost Multiplier.
_Avoid_: auto-fill, populate

## Failure handling

**Cooldown-class Failure**:
A failure that is expected to clear on its own: rate limit, server error, network error, TTFT timeout, no-progress timeout.
_Avoid_: transient error, soft failure

**Persistent Failure**:
A failure that will not clear without user action: bad credentials, forbidden, unknown model, exhausted quota.
_Avoid_: hard error, fatal error

**Compatibility Retry**:
A local re-send after the endpoint rejected a request parameter. It carries no penalty for the Target.
_Avoid_: negotiation, parameter fallback

**Cooldown Level**:
The count of consecutive Cooldown-class Failures on a Target. It selects the cooldown duration; one success returns it to zero.
_Avoid_: strike count, penalty tier

**Cooldown**:
The time window during which a Target is skipped after a Cooldown-class Failure.
_Avoid_: backoff (reserved for in-request retry delays), ban, penalty

**Manual Recovery**:
The state of a Target after a Persistent Failure. The Target stays excluded until the user resets it.
_Avoid_: disabled, blacklisted, dead

**TTFT Budget**:
The time allowed between sending a request and receiving its first meaningful delta.
_Avoid_: first-token timeout, latency limit

**TTFT Action**:
What happens when the TTFT Budget runs out: `cooldown-only` finishes the request and cools the Target; `abort` cancels, cools, and moves to the next Target.
_Avoid_: timeout mode, strategy

**No-Progress Budget**:
The longest silence tolerated after the first delta before the Target is treated as failed.
_Avoid_: stall timeout, idle timeout

**Error Handling Mode**:
A Target's policy on failure: `smart` classifies and decides, `switch` moves on at once, `retry` stays on the Target up to its retry limit.
_Avoid_: failure policy, fallback mode

## Records and state

**Shared State**:
The cross-session file holding every Target's runtime state so all Pi sessions on the machine agree on cooldowns.
_Avoid_: cache, global state, session state

**Failover Event**:
One recorded switch or failure: when, which session, from which Target to which, why, and how long it took.
_Avoid_: log line, entry, record

**History Log**:
The rolling list of the newest Failover Events.
_Avoid_: audit log, journal

**Reset**:
The user action that clears a Target's Cooldown Level, Cooldown, and Manual Recovery.
_Avoid_: unban, clear, revive

## Interface

**List Rows**:
The number of data rows visible in any list, chosen by the user (5 to 20). Header, tab bar, and footer do not count.
_Avoid_: page size, height, viewport

**Tab**:
One of the four top-level screens: Model Manager, Failover Chains, History Log, Settings.
_Avoid_: page, panel, view

**Key Hints**:
The one or two footer lines listing the keys available on the current screen.
_Avoid_: legend, shortcuts bar

**Help Overlay**:
The full-screen key reference toggled with `?`.
_Avoid_: cheat sheet, manual
