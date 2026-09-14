---
status: accepted
---

# Use Pi's Official Event Stream in the Failover Provider Adapter

P2 uses `@earendil-works/pi-ai`'s `createAssistantMessageEventStream` in `adapters/failoverProvider.ts` instead of copying a local event-stream implementation.

## Context

The installed Pi extension contract exposes `ProviderConfig.streamSimple`, which returns `AssistantMessageEventStream`. The `@earendil-works/pi-coding-agent` root package exposes the ProviderConfig type but does not re-export the stream constructor. The failover adapter must preserve Pi's terminal `done`/`error` behavior and its `.result()` promise while buffering failed Target attempts so their partial output is not sent to Pi.

## Decision

- Declare `@earendil-works/pi-ai` as a peer dependency and dev dependency in the same `^0.85.1` range as the installed Pi packages.
- Import only the event-stream factory and required type-only Pi AI contracts from `@earendil-works/pi-ai` in the adapter layer.
- Keep `domain/engine.ts` independent of Pi AI types by using the project's `Attempt` and `StreamChunk` interfaces.
- Use the legacy `registerProvider("failover", config)` extension seam because it owns auth composition and accepts the custom `streamSimple` callback directly.

## Consequences

The adapter uses the official `.result()` and terminal-event semantics, so Pi can consume the failover stream like any other provider. The package gains one direct peer seam that must stay aligned with the supported Pi major; P4 pins and verifies the final peer ranges. A local stream clone is not maintained.
