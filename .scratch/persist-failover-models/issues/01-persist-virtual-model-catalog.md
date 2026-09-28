Status: done
Allowed edit surfaces: `src/domain/types.ts`, `src/domain/providers.ts`, `src/adapters/modelsJson.ts`, `src/adapters/registrar.ts`, `src/index.ts`, `src/tui/tabs/chains.ts`, `src/tui/tabs/chains/importPreview.ts`, `src/tui/tabs/chains/targetForm.ts`, `test/domain/failoverCatalog.spec.ts`, `test/adapters/modelsJson.spec.ts`, `test/adapters/registrar.persistence.spec.ts`, `test/adapters/registrar.spec.ts`, `test/index.failoverCatalog.spec.ts`, `test/integration/failoverModelDiscovery.spec.ts`, `test/integration/childModelRuntime.spec.ts`, `test/fixtures/model-discovery-child.mjs`, `test/tui/app.spec.ts`, `docs/design/03-components.md`
Acceptance: tests prove virtual failover models persist in `models.json`, remain discoverable by a fresh official Pi `ModelRuntime`, and are paired with the runtime handler when the extension loads; run `npm run check` and `git diff --check`.

Persist the generated `failover/<chain-id>` catalog as a reserved, marked provider in the user's Pi `models.json`. Each Pi process that loads this extension must continue to register the actual custom `pi-model-failover` stream handler from the persisted Chain configuration. The JSON entry alone is only a model catalog, not executable routing.

Preserve unrelated models.json fields, model-scoped `api` and `baseUrl`, user provider data, and existing failover state/history semantics. Never serialize the placeholder runtime API key/base URL into the persisted virtual provider. Remove only this extension's marked virtual provider when no virtual models remain. Keep the branch isolated from `main` and leave merging to the user.

## Comments

- RED: domain and models.json regression tests initially failed because `syncFailoverVirtualModels` was absent and the reserved `pi-model-failover` API was rejected.
- GREEN: catalog synchronization, strict validation, Registrar persistence, fresh-process discovery, fresh-host restoration/cleanup, and official child-session runtime sharing now pass.
- Targeted verification: 7 tests passed across the catalog, child-session, discovery, and restart suites.
- Full `npm run check` (using `/tmp` tool wrappers required by FUSE storage): TypeScript, Biome, 59 test files, 549 tests passed.
- `git diff --check` passed; main remains unchanged.
