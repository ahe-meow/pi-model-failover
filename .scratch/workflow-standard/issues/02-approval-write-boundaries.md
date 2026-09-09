Status: claimed
Allowed edit surfaces:

- workflows/task-lifecycle.js
- test/workflows/task-lifecycle.spec.ts
- docs/agents/workflows/reference.md
- docs/agents/workflows/lifecycle.md
- .scratch/workflow-standard/issues/02-approval-write-boundaries.md
Acceptance:
- Each repair writer requires its own foreground confirm checkpoint with default false and headless abort; only literal true permits that round.
- Denial, dismissal, non-boolean answers, unavailable UI, or errors block dependent repair; retain scoped prompt context and a decision ledger.
- Initial parentApproval never approves repair; plan/verify never confirm or repair; at most two confirmations and two repairs.
- Record genuine focused RED against unchanged source, then focused GREEN, full Vitest, tsc, Biome, and npm run check offline in fresh matching-manifest snapshots.
- Per unit: at most 400 added plus removed lines from pre-unit copies; source at most 400 lines, dedicated test at most 600; preserve all out-of-scope inputs.

## Work Units

- UNIT A: foreground per-round approval gate, checkpoint fake and approval regressions, foreground invocation/replay/budget docs, and this issue's evidence. Source size reduction must be minimal and non-semantic.
- UNIT B: write-boundary enforcement and its focused regressions/documentation, separately scoped and validated after A. It is not implemented by UNIT A.
- Verification-before-review, command-evidence, snapshot-provenance, and documentation-only findings remain later work. No product work, nested agents, installation, Git mutation, publication, global configuration, or real lifecycle execution.

## Prerequisites

- Approved foreground runtime checkpoint design; installed runtime and capability checkpoint contracts inspected.
- Source SHA256 b43ec9d1f5d7b583207e158c35587edc3c3a39fdafcb6cd888152d5ffbc0c218; test SHA256 ae7a17beb23a8cb3b54adf79b26d8633e610708b97b2eb714135793e03141752.

## Evidence Paths

- Pre-unit copies and source/copy, Git, dependency manifests: /tmp/pmf-approval-baseline.ShgJJs/.
- Fresh RED and GREEN snapshot roots and command evidence are appended below.

## Comments

### UNIT A Claim

- Only the five exact surfaces above are claimed. Issue 01, package metadata, biome.json, other docs, src/, and product tests are read-only inputs.
- Existing source/test hashes match the supplied baseline. No real workflow is invoked; dedicated tests execute the controller with fake runtime boundaries.

### UNIT A Implementation and Verification - 2026-09-08T22:23Z

- Baseline: root `/tmp/pmf-approval-baseline.ShgJJs/`; source SHA256 `b43ec9d1f5d7b583207e158c35587edc3c3a39fdafcb6cd888152d5ffbc0c218` (399 lines); test SHA256 `ae7a17beb23a8cb3b54adf79b26d8633e610708b97b2eb714135793e03141752` (179 lines).
- Final: source SHA256 `c023bc942ce6a044357af6e43e89a33105472ce7733e7f297790f722eba1a760` (400 lines); test SHA256 `c46f5110d388fe1e9778b961c51c9b75b2bb570191c2e2b25244a44262b3d157` (331 lines).
- Scope: only these five exact UNIT A surfaces changed relative to that baseline: `workflows/task-lifecycle.js`, `test/workflows/task-lifecycle.spec.ts`, `docs/agents/workflows/reference.md`, `docs/agents/workflows/lifecycle.md`, and `.scratch/workflow-standard/issues/02-approval-write-boundaries.md`.
- Changed lines: 167 combined (source 5 added/4 removed; test 155 added/3 removed).
- RED: `npm test -- test/workflows/task-lifecycle.spec.ts`; exit `1`; output `/tmp/pmf-approval-red.QR8qzq/evidence/focused.out`; genuine pre-implementation evidence with 13 approval failures caused by missing checkpoint behavior.
- GREEN: focused `npm test -- test/workflows/task-lifecycle.spec.ts`; exit `0`; output `/tmp/pmf-unit-a-evidence.7vrx1n/evidence/focused.out`; 23/23 tests passed.
- Verification from `/tmp/pmf-unit-a-evidence.7vrx1n/evidence/commands.tsv`: full Vitest `npm test`; exit `0`; output `/tmp/pmf-unit-a-evidence.7vrx1n/evidence/full-vitest.out`; 54/54 tests passed. `npx tsc --noEmit`; exit `0`; output `/tmp/pmf-unit-a-evidence.7vrx1n/evidence/typecheck.out`. `npx biome check .`; exit `0`; output `/tmp/pmf-unit-a-evidence.7vrx1n/evidence/biome.out`. `npm run check`; exit `0`; output `/tmp/pmf-unit-a-evidence.7vrx1n/evidence/npm-check.out`.
- Snapshot and manifests: snapshot `/tmp/pmf-unit-a-evidence.7vrx1n/snapshot`; source manifest `/tmp/pmf-unit-a-evidence.7vrx1n/evidence/source.sha256`; copy manifest `/tmp/pmf-unit-a-evidence.7vrx1n/evidence/copy.sha256`; matching diff `/tmp/pmf-unit-a-evidence.7vrx1n/evidence/matching-manifest.diff`; manifest diff exit `0`.
- The existing dependency snapshot was reused offline. No install, network, real lifecycle execution, commit, or push occurred.
- Parent acceptance: pending. UNIT B and later verification-before-review/write-boundary work remain out of scope.

### UNIT A Safety Repair and Verification - 2026-09-08T23:42Z

- Scope: This is the bounded same-scope repair for foreground checkpoint prompt safety and clarity, not UNIT B.
- Pre-repair hashes: `workflows/task-lifecycle.js` SHA256 `c023bc942ce6a044357af6e43e89a33105472ce7733e7f297790f722eba1a760` (400 lines); `test/workflows/task-lifecycle.spec.ts` SHA256 `c46f5110d388fe1e9778b961c51c9b75b2bb570191c2e2b25244a44262b3d157` (331 lines).
- Final current hashes: `workflows/task-lifecycle.js` SHA256 `9889d3814d2171489b2669096e181ce4b07fe477c316fb1ab98ede688382c3a9` (400 lines); `test/workflows/task-lifecycle.spec.ts` SHA256 `22511e90a078b71349ef34689a505611e1b4eb3db6cc491369c53d9d07eb1929` (379 lines).
- Genuine RED: snapshot `/tmp/pmf-unit-a-safety-red.Ywk1eR/repo`; command `npm_config_offline=true CI=1 npx vitest run test/workflows/task-lifecycle.spec.ts`; exit `1`; output `/tmp/pmf-unit-a-safety-red.Ywk1eR/evidence/focused-red.out`. There were 26 tests total, 23 passed, and exactly 3 new safety tests failed for the raw report secret, raw checkpoint error, and unclear confirmation wording.
- Focused GREEN: snapshot `/tmp/pmf-unit-a-safety-green.7V8ECo/repo`; same focused command; exit `0`; output `/tmp/pmf-unit-a-safety-green.7V8ECo/evidence/focused-green.out`; 26/26 passed.
- Final verification: snapshot `/tmp/pmf-unit-a-safety-final.hqQ0vs/snapshot`; evidence `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence`; manifest files `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence/source.sha256` and `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence/copy.sha256`; `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence/matching-manifest.diff` exit `0`.
- Evidence from `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence/commands.tsv`: focused exit `0`, 26/26, output `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence/focused.out`, SHA256 `fe0a795d1c6a2a9bd9c155b1d7d49d07e2d2f651ce82d6788d02184cb15d7e90`; full Vitest exit `0`, 57/57, output `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence/full-vitest.out`, SHA256 `70595c4f9df05f3c842e4d8db11382619ab115d5ec9723dc2afba529a0eecf73`; `npx tsc --noEmit` exit `0`, output `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence/typecheck.out`, SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; `npx biome check .` exit `0`, output `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence/biome.out`, SHA256 `8ffa1840b0d1c1f0111fd935d0b647434eb9c09330941bc9d7678defe55113c8`; `npm run check` exit `0`, output `/tmp/pmf-unit-a-safety-final.hqQ0vs/evidence/npm-check.out`, SHA256 `bc8aa18df62d06b5a7b059c5943f0dc5b539c93333c7282089a3ab35c3028b5b`.
- The existing dependency snapshot was reused offline. No install, network access, real workflow execution, commit, or push occurred.
- Source/test/doc changes remain within the claimed UNIT A surfaces. Source is at most 400 lines and the dedicated test is at most 600 lines. Parent acceptance is pending. UNIT B plus workflow-wide pre-existing lint/type coverage remain out of scope.
- Review completion is not claimed in this subsection; it will be recorded separately after the fresh read-only review.

### UNIT A Redaction Boundary Repair and Final Verification - 2026-09-08T22:58Z

- This is the bounded UNIT A redaction boundary repair after the fresh quality-review blockers. It is not UNIT B. The edge-test RED snapshot is `/tmp/pmf-unit-a-redaction-red.952fli/repo` with output `/tmp/pmf-unit-a-redaction-red.952fli/evidence/focused-red.out` and exit `1`: 29 tests total, 26 passed, 3 failed. The three failures were embedded ordinary report strings, a JSON checkpoint error, and a non-boolean checkpoint decision. The pre-repair source/test hashes are workflow `9889d3814d2171489b2669096e181ce4b07fe477c316fb1ab98ede688382c3a9` and test `535c06884863a47f839c51962bc65cabd4b7f32eee5701e2505880b643963fef`.
- The first source repair produced an intermediate focused result in `/tmp/pmf-unit-a-redaction-green.PvYWRR/evidence/focused-green.out` with exit `1`: 29 tests, 28 passed, 1 failed because the embedded-key regex matched the ordinary word `authorizes`. This was corrected by narrowing the regex; it is diagnostic evidence, not final GREEN.
- Final current hashes are workflow `675f335df05482f53a3c7fce2d097d8992535390d28de62dc9ac877cc7e8ca5d` (399 lines) and test `535c06884863a47f839c51962bc65cabd4b7f32eee5701e2505880b643963fef` (421 lines). The final focused GREEN snapshot is `/tmp/pmf-unit-a-redaction-green2.iPJnfy/repo`; command `npm_config_offline=true CI=1 npx vitest run test/workflows/task-lifecycle.spec.ts`; output `/tmp/pmf-unit-a-redaction-green2.iPJnfy/evidence/focused-green.out`; exit `0`; 29/29 passed.
- Final verification snapshot is `/tmp/pmf-unit-a-redaction-final2.8hebTB/repo` and evidence directory `/tmp/pmf-unit-a-redaction-final2.8hebTB/evidence`. Source and copy manifests are `evidence/source.sha256` and `evidence/copy.sha256`; `matching-manifest.diff` exists and `matching-manifest.exit` is `0`.
- The ledger `evidence/commands.tsv` has columns label, exact command, cwd, output path, output SHA256, and exit code. The exact rows/results are:
  - `focused`; command `npm_config_offline=true CI=1 npx vitest run test/workflows/task-lifecycle.spec.ts`; cwd `/tmp/pmf-unit-a-redaction-final2.8hebTB/repo`; output `evidence/focused-vitest.out`; SHA256 `57c6845a9a00e0c60b62dfc6ce72e3c1c78a7f999b3c804e55815fcb6848f472`; exit `0`; 29/29.
  - `full`; command `npm_config_offline=true CI=1 npx vitest run`; cwd `/tmp/pmf-unit-a-redaction-final2.8hebTB/repo`; output `evidence/full-vitest.out`; SHA256 `c66c25a47496c397dacb7f6558113a121f4fc072825044869d4d771c077a1e3f`; exit `0`; 60/60 across 10 files.
  - `typecheck`; command `npm_config_offline=true CI=1 npx tsc --noEmit`; cwd `/tmp/pmf-unit-a-redaction-final2.8hebTB/repo`; output `evidence/typecheck.out`; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; exit `0`.
  - `biome`; command `npm_config_offline=true CI=1 npx biome check .`; cwd `/tmp/pmf-unit-a-redaction-final2.8hebTB/repo`; output `evidence/biome.out`; SHA256 `b9596da4b15d352ab106aad27b820e519097353e25769c6d1b0be92135e8fd29`; exit `0`.
  - `npm-check`; command `npm_config_offline=true CI=1 npm run check`; cwd `/tmp/pmf-unit-a-redaction-final2.8hebTB/repo`; output `evidence/npm-check.out`; SHA256 `5f4f21d3033d166d38b53c2b971a475673c75e633b6d2c754cd43712855e435`; exit `0`.
- All final commands ran from cwd `/tmp/pmf-unit-a-redaction-final2.8hebTB/repo` using the existing dependency snapshot offline. No install, network access, real lifecycle execution, commit, or push occurred. The current UNIT A source/test/doc surfaces remain within scope; current source is `<=400` lines, dedicated test `<=600` lines, and total delta against `/tmp/pmf-approval-baseline.ShgJJs/repo` across the five claimed surfaces is 375 added+removed lines. All delegated agents in this repair used the current parent model route `017-wanju/gpt-5.6-luna:max`. Parent acceptance remains pending. UNIT B and excluded workflow-wide diagnostics remain out of scope. Do not state review completion; fresh read-only reviews follow.

### UNIT A Final Current Verification - 2026-09-09T10:54Z

- Final workflow SHA256 b0f6f5c4281386dcde5f85f8691b0a00b47339edd8564d2e320900afb1a949ed (399 lines); dedicated test SHA256 625b178a430bc0fa3515b73d0c683957989e23126baf5c691210760b0382a574 (422 lines).
- Five-surface delta against /tmp/pmf-approval-baseline.ShgJJs/repo: +368/-32 = 400, within the 400 changed-line limit.
- Task #22 RED: npm_config_offline=true CI=1 npx --no-install vitest run test/workflows/task-lifecycle.spec.ts; cwd /tmp/pmf-unit-a-task22-red.qhQoLM; output /tmp/pmf-unit-a-task22-red.qhQoLM/evidence/focused-red.out; exit 1; output hash 796dbfd8ce9bca39ef4da3fbf8850fd74afb2b6f1593bc14592d8a54d55b15ee; 31 tests with the intended bracket-prefix/short-sk/Bearer-placeholder redaction failure.
- Task #22 focused GREEN: /tmp/pmf-unit-a-task22-green.e5zRpq/evidence/focused-green.out; exit 0; output hash f28827caa1e7ce945fefc74c13399de2568a96558b1cfd19ca5c5d475b654232; 31/31; source remains 399 lines.
- Final fresh snapshot: /tmp/pmf-unit-a-final-acceptance-v8.qoIVzu; complete copied-input manifest including openspec/config.yaml and matching-manifest exit are under evidence/; final command ledger, primary LSP artifact, and independent final review report are under the same evidence directory; UNIT B remains out of scope.
