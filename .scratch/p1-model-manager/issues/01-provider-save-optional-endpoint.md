Status: done
Allowed edit surfaces: test/tui/modelManager/providerForm.spec.ts, src/adapters/modelsJson.ts
Acceptance: regression test passes; npm run check

Editing a provider currently fails when any other valid Pi provider omits provider-level `api` and `baseUrl`, relying on model-level values instead. Preserve that Pi-supported shape during an unrelated provider edit.

## Comments

- RED: `test/tui/modelManager/providerForm.spec.ts` failed because the unrelated model-scoped provider caused the saved name to remain `Relay`.
- GREEN: the regression test passes after provider-level `api` and `baseUrl` became optional in strict write validation.
- Verification: `npm run check` passed: typecheck, Biome, 54 test files, 538 tests. The shared-storage mount lacks executable support and symlinks, so temporary `/tmp` wrappers were used without changing dependencies.
