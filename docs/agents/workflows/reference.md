# Workflow Reference

This reference defines the contract for the forthcoming `workflows/task-lifecycle.js`. The issue file and repository design docs remain authoritative. A product-spec conflict is reported to the parent and blocks the run; this reference never resolves one by preference.

## Invocation Contract

The script accepts one JSON value through `args`:

```ts
type TaskArgs = {
  taskId: string;
  issuePath: string;
  mode?: "plan" | "develop" | "verify";
  parentApproval?: {
    mode: "develop" | "verify";
    source: "parent";
    evidence: string;
  };
};
```

`mode` defaults to `plan`. `taskId` must identify one task in the named active plan, and `issuePath` must resolve to its issue. `parentApproval` is required, matching the mode, for `develop` and `verify`. It is an attestation record, not a security boundary: the external parent/host must authorize the operation. A background confirmation must not silently become approval.

The script returns this JSON shape and no implicit success:

```ts
type TaskReport = {
  status: "planned" | "ready_for_acceptance" | "blocked";
  mode: "plan" | "develop" | "verify";
  taskId: string;
  issuePath: string;
  changedPaths: string[];
  evidence: {
    intake: string;
    snapshot: SnapshotEvidence;
    red: StageEvidence | NotApplicable;
    green: StageEvidence | NotApplicable;
    verification: StageEvidence[];
    review: {
      spec: ReviewEvidence | NotApplicable;
      quality: ReviewEvidence | NotApplicable;
    };
    handoff: HandoffEvidence;
  };
  blockers: string[];
  forwardLinks: string[];
};

type NotApplicable = { applicable: false; reason: string };
type CommandEvidence = {
  command: string;
  cwd: string;
  exitCode: number;
  outputPath: string;
  outputSha256: string;
  summary: string;
};
type StageEvidence = CommandEvidence & { applicable: true };
type SnapshotEvidence = {
  root: string;
  sourceManifest: string;
  copyManifest: string;
  matchingManifestDiff: string;
};
type ReviewEvidence = {
  reportPath: string;
  snapshotRoot: string;
  summary: string;
};
type HandoffEvidence = {
  artifactPaths: string[];
  manualChecks: string[];
  knownGaps: string[];
  issueEvidencePath: string;
};
```

`status: "planned"` is read-only planning, `"ready_for_acceptance"` is a completed evidence handoff, and `"blocked"` has at least one nonblank blocker. `done` is never a workflow result: the parent accepts the handoff and the issue owner changes the issue status separately. The host records the canonical `runId` returned by workflow start/status beside this report; the script must not invent one. `workflow_control list` is for wayfinding and omits `runId`; use the canonical ID from start/status for `status`, `pause`, `resume`, and `stop`.

## Script and Runtime Rules

The saved script starts with the only legal export:

```js
export const meta = {
  name: "task_lifecycle",
  description: "Run one approved task through bounded evidence gates",
  phases: [{ title: "Intake" }, { title: "Execute" }, { title: "Handoff" }],
};
```

`meta` values are literal. Phases belong inside `meta`, and each declared phase is entered with `phase()` before its work. `meta` is the only legal export. Use `agent()` labels that are short and unique when a delegated writer or reviewer is part of the approved task. Use schemas to validate result shape, but treat schema success as shape validation, not proof that the claims are true. Return plain JSON only. New workflow code uses `log()` and has no imports, filesystem access, `Date.now()`, `Math.random()`, or no-argument `new Date()`.

The approved global `defaultAgentTimeoutMs` is `null`. Routine invocations omit both `agentTimeoutMs` and `tokenBudget`; omission inherits the runtime configuration. New-run persisted limits must be checked after `/reload`. A paused or running old run keeps the limits it started with. `small`, `medium`, and `big` are model-routing tiers, not thinking-intensity settings. Use only those configured routes unless the parent supplies another name; do not invent a maximum tier or an `agentType`.

Run source explicitly with `workflow(script=<file contents>, args=<TaskArgs>)`. The supported `/workflows save <name>` command may save a reviewed script for later named invocation. A repository folder is not auto-discovered, and this workflow does not install or copy anything implicitly.

Workflow state is extension-managed outside the repository under `~/.pi/workflows`: global settings and tiers, project runs/journals/locks, saved workflows, and optional project tier overlays. A repository file is not discovered as a saved workflow. Persisted agent sessions are opt-in and may contain sensitive transcripts; enabling them is a deliberate parent decision. Use the canonical run ID for persisted run control.

## Resume and Supervision

Resume replays only the longest unchanged positional prefix of agent calls that finished with real results. The first changed, inserted, removed, or reordered call and everything after it runs live. A `null` result is missing coverage and is not cached, so it is rerun on resume. Keep stable IDs and actual results paired before filtering; never turn missing coverage into a negative finding.

The five-minute `NO-PROGRESS` threshold belongs to parent/host supervision, not to a script timer. Track the last observable step activity. At the threshold, inspect `workflow_control status <canonical-run-id>`; then the parent chooses pause, stop, or recovery based on the status. Do not blindly retry a mutating writer. A resumed run must preserve the unchanged real-result prefix and use the same snapshot rules.

Read-only checks may run in parallel only after all writers are quiescent and every checker uses the same verified snapshot. There is one writer by default; parallel writers require explicit user approval and verified isolation.

## Foreground Per-Round Repair Approval

Callers must run the workflow in the foreground with `background=false` whenever `develop` may reach a repair checkpoint: `workflow(script=<file contents>, args=<TaskArgs>, background=false)`. Background/headless execution aborts at the checkpoint and does not authorize repair. Each bounded same-scope repair round requires a fresh foreground decision immediately before its repair writer. The runtime call is `await checkpoint(prompt, { kind: "confirm", default: false, headless: "abort" });`. Only literal `true` permits that round's repair writer; `false`, `null`, `undefined`, any non-boolean answer, a missing `checkpoint`, or a checkpoint error blocks the repair and records the decision or failure in the ledger. The invocation's `parentApproval` (ParentApproval) is not a repair approval.

There are at most two repair rounds, and each asks independently. Plan and verify never call `checkpoint`; it is a foreground decision, not an `agent()` call or parallel work. Resume/replay must not infer approval from an old `parentApproval` or writer result, and agent or semantic budgets do not authorize more than two checkpointed repairs.

## Validation Snapshot

Use a fresh internal-filesystem directory from `mkdtemp` for every validation attempt, or an already-proved internal tool entry whose `cwd` is that snapshot. Never reuse an old directory. Before checks:

1. Capture the shared-storage baseline, including `git status --short` and every dirty or untracked path.
2. Copy `src/`, `test/`, `workflows/` when present, configuration files (including `openspec/config.yaml`), package metadata (`package.json` and `package-lock.json` when present), and every permitted doc/issue input into the snapshot. Include untracked inputs; enumerate them with `git ls-files --others --exclude-standard`, not only `git ls-files`.
3. Write a sorted identity manifest for both source and copy. Each entry records the repository-relative path, regular-file type, byte size, and SHA-256. Compare the manifests with `diff -u` and require exit code 0 before checks.
4. Run each command from the snapshot `cwd`, capture stdout and stderr to a unique output file, capture the exit code immediately, and record the command, cwd, output path, output hash, and exit code. A nonempty report is required even when the command fails.
5. For doc-only work, inspect only the permitted paths, run `git diff --check` (or `git diff --no-index --check` for an untracked file), and record the expected no-index exit code when comparing `/dev/null` to a new file.

The snapshot gate fails for a missing input, missing hash, mismatch, stale copy, missing dependency/tool, network or install attempt, overwritten old `/tmp` data, rewritten `node_modules/.bin`, shared-storage permission mutation, destructive cleanup, missing output, or an unrecorded exit code. Existing dependencies may be reused; they are never installed during validation. Do not claim product tests passed when this unit ran only documentation checks.

## Evidence Template

Each implementation issue keeps this shape before its comments:

```md
Status: open
Allowed edit surfaces:
- exact/repository-relative/path
Acceptance:
- exact command or named manual gate

## Prerequisites
- explicit or inferred prerequisite, labeled

## Evidence Paths
- snapshot, command-output, and reviewer-report paths

## Comments
```

Append to the existing issue under its single `## Comments` heading. Do not rewrite prior comments or create another comments heading. Use one run subsection per invocation:

```md
### Run <canonical run ID> - <UTC timestamp>
- Scope: `<taskId>`; mode: `plan|develop|verify`; allowed paths: `...`.
- Baseline/snapshot: `<status path>`; `<snapshot root>`; matching manifests: `<paths>`.
- RED: `<command>`; exit `<n>`; output `<path>`; `<summary>`.
- GREEN: `<command>`; exit `<n>`; output `<path>`; `<summary>`.
- Verification: `<command>`; exit `<n>`; output `<path>`; repeat for every applicable gate.
- Review: spec `<report path>`; quality `<report path>`; both used `<snapshot root>`.
- Handoff: artifacts `<paths>`; manual checks `<pending|complete>`; known gaps `<none|...>`.
- Forward links waiting for later units: `<paths>`.
```

For documentation-only work, write `RED: not applicable - documentation-only; scope inspection and diff checks are the gate.` Do not manufacture a failure. Use the genuine original RED from before production edits for code tasks. A later test made to fail by removing already-written source is a regression check, not the original TDD RED, and must never be labeled as original RED.

Implementation issue statuses are `open`, `claimed`, `done`, and `blocked`. Wayfinding child tickets use `open`, `claimed`, and `resolved`; `resolved` answers a question and is not implementation completion. `ready_for_acceptance` is a report status, not an issue status. Every command and review entry needs an output path and exit/result evidence; null, empty, stale, or unverifiable evidence blocks acceptance.

## Recovery Matrix

| Condition | Required response |
| --- | --- |
| Missing output, null report, or empty report | Mark `blocked`; preserve the command and cwd; inspect the artifact path and tool result. Repeat only the same read-only check after the parent confirms the cause. |
| Tooling or dependency failure | Mark `blocked`; record the exact exit/output. Use an already-proved tool entry or parent-approved limitation; never convert unavailable tooling into pass and never install as recovery. |
| Spec or source conflict | Stop before writing; name the conflicting paths and claims; ask the parent/user to resolve. Do not silently choose a roadmap, skill, or agent guess. |
| Failed review | Repair only an in-scope finding, with parent approval, for at most two bounded rounds; rerun affected verification and both reviews. Otherwise create a new task or block. Never auto-start it. |
| Five-minute no-progress threshold | Inspect `workflow_control status` using the canonical run ID. If progress is real, continue; otherwise parent chooses pause, stop, or recovery. Never blindly retry a mutating agent. |
| Scope violation or unexpected changed path | Stop writing immediately; record the exact path and baseline comparison; preserve unrelated changes. Parent decides whether a separate task is needed. Do not reset, clean, or revert user work. |
