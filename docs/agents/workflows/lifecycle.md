# Task Lifecycle

This procedure is the contract for the saved workflow at `workflows/task-lifecycle.js`. One invocation handles one task/work unit. It never starts a future task, closes an issue, commits, pushes, or publishes.

The issue at the required `issuePath` is authoritative for the task's exact edit surfaces, prerequisites, acceptance commands, estimated changed lines, and evidence paths. Repository design docs and ADRs are the authority for behavior. A conflict is reported to the parent and blocks the run; it is never resolved by silently preferring a stale roadmap, a skill suggestion, or an agent guess.

## Runtime Contract

The workflow uses the installed runtime API:

- Export a literal `meta` object with a nonblank name and description, and declare only used phases.
- Enter every declared phase with `phase()` before doing that phase's work.
- Use labeled `agent()` calls when delegated analysis or review is required; labels are short and unique. Record each intended work item before filtering a result.
- Bound `maxAgents`, concurrency, retries, and semantic loops. Omit invocation token and timeout caps unless the caller supplies them.
- Use `log()` for new runtime messages and return explicit JSON data. `null` is missing coverage, not a negative result.
- Do not use imports, filesystem modules, `Date.now()`, `Math.random()`, or a no-argument `new Date()` in the saved script. Pass external decisions through `args`.

A runtime completion is not accepted work. Every required gate must have nonempty, verifiable evidence.

## Modes and Authority

| Mode | Behavior | Write policy |
| --- | --- | --- |
| `plan` | Read-only intake, mapping, prerequisite checks, and a proposed execution record. It is the default. | No product, test, issue, or workflow writes. |
| `develop` | Executes the approved task through implementation, verification, review, and handoff. | Writes only the issue's exact edit surfaces after parent-attested approval. |
| `verify` | Checks existing work against the issue and acceptance contract. | Read-only; it does not repair, claim, close, or expand the task. |

Every invocation requires `taskId` and `issuePath`. The task ID comes from the named active plan. The current P0 detailed plan has 11 tasks; a stale roadmap number is not permission to infer scope. A documented crosswalk is required before using one. The parent must attest user approval for `develop` and `verify`; an `approved: true` or similar boolean argument is not real authority and is not a security boundary.

Default concurrency is one writer. Parallel writers require explicit user approval for separate worktrees and verified isolation. A best-effort isolation fallback is unsafe and blocks the run. Read-only reviewers may run in parallel only over the same verified snapshot.

## Ordered Lifecycle

The stages below are strictly ordered. A failed gate stops the invocation and records `blocked`; later stages do not run.

### 1. Intake, Clarify, and Approval

**Inputs:** invocation arguments, `taskId`, `issuePath`, the issue contents, the named active plan, repository docs, ADRs, and the parent's authority record.

**Actors:** parent supplies task selection and approval; the workflow validates shape and resolves the issue; the user resolves genuine ambiguity through the parent.

**Outputs:** normalized task identity, selected mode, authority status, and a list of questions or blocking conflicts.

**Pass gate:** both required paths exist; the issue is readable; its status and edit surfaces are compatible with the mode; the task is one work unit; all scope questions have a recorded answer.

**Fail gate:** missing or mismatched task/issue, an unapproved `develop` or `verify`, stale numbering without a crosswalk, unresolved conflict, or a null, empty, or error report. Do not guess.

### 2. Preflight and Snapshot

**Inputs:** current dirty baseline, dependency metadata and existing dependency installation, acceptance tools, and the documents named by the issue.

**Actors:** workflow performs read-only checks; parent owns decisions about unrelated work and dependency acceptance.

**Outputs:** baseline status, accepted dependency/tool report, conflict report, and a fresh internal-filesystem validation snapshot with matching hashes for `src`, `test`, `workflows` when present, configs, and package metadata.

**Pass gate:** the current dirty and untracked baseline is captured; required existing dependencies and tools are available without installation; no unresolved document conflict remains; unrelated work is preserved. Validation inputs are copied before checks and their hashes match the snapshot manifest.

**Fail gate:** any required dependency is missing, an installation would be needed, a hash is missing or mismatched, the snapshot is stale, or a check would overwrite or clean unrelated work. Do not mutate shared-storage permissions or rewrite shared dependency shims.

### 3. Mapping and Task Claim

**Inputs:** the issue's allowed edit surfaces, prerequisite list, acceptance commands, line estimate, evidence paths, and the preflight snapshot.

**Actors:** a read-only mapper identifies contracts and dependencies; the parent confirms the claim; the workflow enforces the issue boundary.

**Outputs:** a map of files, symbols or sections, dependencies, risks, and expected changed lines, plus a task claim record.

**Pass gate:** a task touching or relying on four or more files has a mapping before any write; the map names all four or more files. The estimate is at most 400 added plus removed lines for the work unit, and any task over 400 lines is split first. The parent records the issue as claimed before `develop` or `verify` proceeds.

**Fail gate:** incomplete mapping, an unclaimed issue, an estimate over 400 lines, an edit surface that differs from the issue, or an attempted scope expansion. Plan reports the proposed claim without writing it.

### 4. Test Writer and Independent RED Check

**Inputs:** the accepted map, issue acceptance, and the same validation snapshot.

**Actors:** the test writer adds or updates only the permitted test surface; an independent checker runs the focused acceptance before production code changes; the parent observes the evidence.

**Outputs:** the focused test artifact, the RED command and exit code, and a captured failure showing the requested behavior is not yet satisfied.

**Pass gate:** for a code task, the original focused test run fails for the intended reason before production edits. The checker is independent of the writer and reports command, exit code, and nonempty output.

**Documentation-only rule:** an issue may explicitly identify a documentation-only unit and its scope/diff checks instead of a test. Record why RED is not applicable. If a code task lacks its original RED evidence, that is a gap and blocks the run; never fabricate a failure after implementation.

**Fail gate:** a passing, unrelated, empty, null, or error report; a missing original RED; a changed production file before the check; or a test outside the exact surface.

### 5. Minimal Implementation and Focused GREEN

**Inputs:** the RED artifact, approved issue surface, source authority, and parent-attested `develop` approval.

**Actors:** one writer makes the smallest implementation; the writer self-reviews the diff and boundaries; the focused verifier runs the changed acceptance.

**Outputs:** changed artifacts, self-review notes, focused GREEN command and exit code, and an updated hash manifest.

**Pass gate:** only exact allowed paths changed; behavior follows repository docs and glossary terms; source modules and tests stay within their limits; focused acceptance passes; unrelated dirty and untracked work remains untouched.

**Fail gate:** scope drift, fabricated or missing evidence, a focused failure, an unresolved source conflict, a line-limit breach, secrets in output, or an attempt to start another task. Repair remains within the same issue or blocks for a new one.

### 6. Independent Verification

**Inputs:** the focused GREEN artifact and the same verified snapshot, refreshed only by a bounded same-scope repair.

**Actors:** an independent verifier runs commands read-only and records every exit code; the workflow checks diagnostic availability; the parent does not convert a missing tool into a pass.

**Outputs:** ordered verification evidence:

1. `npx vitest run <changed spec files>` for focused Vitest.
2. `npm test` for the full Vitest suite.
3. `npx tsc --noEmit`.
4. `npx biome check .`.
5. `npm run check`.

Every listed `npx` command must run as `npm_config_offline=true CI=1 npx --no-install ...`; every listed `npm` command must run as `npm_config_offline=true CI=1 npm ...`; no command may install packages or access the network.

6. Diagnostic availability, diff/scope inspection, and changed-line and module/test-size checks.

**Pass gate:** every applicable command exits 0, diagnostics are available or an explicit issue-approved limitation is recorded, the snapshot hashes are known, and diff/size checks confirm the issue boundary and limits. A doc-only unit runs its declared scope inspection and `git diff --check`; it does not claim product checks it did not run.

**Fail gate:** any nonzero exit, unavailable required diagnostic, missing output, null or empty report, unverifiable hash, whitespace error, scope drift, or unreported size breach.

### 7. Parallel Read-Only Review

**Inputs:** the same verified snapshot, all verification evidence, the issue, and the source authority.

**Actors:** the spec reviewer checks behavior against the issue and design docs; the quality reviewer checks maintainability, boundaries, tests, redaction, and repository standards. Both are read-only and may run concurrently.

**Outputs:** two named reports with findings, severity, paths, and evidence references. A reviewer that returns `null`, empty output, or an error has missing coverage and blocks acceptance.

**Pass gate:** both reports are nonempty and contain no unresolved blocking finding. Findings outside the issue become a new task or a parent decision, not an unapproved edit.

**Fail gate:** reviewers inspected different or stale snapshots, either report is unverifiable, or a blocking finding remains.

### 8. Bounded Same-Scope Repair

**Inputs:** reviewer findings, the exact issue surface, and the verified snapshot.

**Actors:** the same writer repairs only the reported in-scope issue; the independent verifier and both reviewers repeat their checks after each repair; the parent approves each repair round.

Each repair round requires a fresh foreground checkpoint immediately before its repair writer: `await checkpoint(prompt, { kind: "confirm", default: false, headless: "abort" });`. Only literal `true` permits that round's repair writer; `false`, `null`, `undefined`, any non-boolean answer, a missing checkpoint, or a checkpoint error blocks the repair and records the decision or failure. The invocation's `parentApproval` (ParentApproval) is not repair approval. At most two rounds ask independently. This is not an `agent()` call or parallel work; plan and verify never call `checkpoint`. Resume/replay must not infer approval from an old `parentApproval` or writer result, and agent or semantic budgets do not authorize more than two checkpointed repairs.

**Outputs:** a repair ledger and new RED/GREEN or verification, review, hash, and diff evidence for the repaired scope.

**Pass gate:** zero or one repair round completes with all gates green. A second and final round is allowed only for the same scope and must repeat every affected gate. At most two rounds are allowed total.

**Fail gate:** a third round, scope expansion, a new task being auto-started, or any repeated red gate. Stop as blocked and hand the parent the evidence.

### 9. Handoff and Parent Acceptance

**Inputs:** final verified snapshot, issue, all reports, and the manual checks named by the issue.

**Actors:** workflow prepares the handoff; parent performs acceptance and decides whether a later user publication gate is requested.

**Outputs:** artifact paths, exact changed paths, baseline preservation note, RED/GREEN or doc-only evidence, focused and full verification results, reviewer reports, required manual checks, known gaps, and the issue evidence path.

**Pass gate:** evidence is nonempty, reproducible from the recorded snapshot, and all required manual checks are clearly marked pending or complete. The executable ends with `ready_for_acceptance`.

**Final rule:** parent acceptance is a separate pause point. The workflow never silently marks an issue done. Commit, push, package publication, and any other publication are a distinct user authorization gate and are absent from the automatic script.

## Evidence and Safety Rules

- Preserve the initial dirty/untracked baseline and compare it with the final scope. Never reset, clean, checkout, rebase, or overwrite unrelated work.
- Keep every report tied to a command, exit code, artifact path, and snapshot hash. A completed runtime without these artifacts is not accepted work.
- Treat `null`, empty, error, missing, stale, or unverifiable evidence as a blocking result, not as success or a negative finding.
- Keep the writer count at one. Review parallelism is read-only and shares the exact verified snapshot.
- Do not infer a future task from a roadmap number, and do not auto-start the next issue after handoff.
