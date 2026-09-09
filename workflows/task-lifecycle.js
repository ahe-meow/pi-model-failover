export const meta = {
  name: "task_lifecycle",
  description: "Run one approved task through bounded evidence gates",
  phases: [{ title: "Intake" }, { title: "Execute" }, { title: "Handoff" }],
};
const has = (value, key) => Object.hasOwn(value, key);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const ENV_REF = /^\$\{?[A-Z_][A-Z0-9_]*\}?$/;
const SECRET_KEY = /key|token|auth/i;
const KEYED_TEXT = /(["']?)((?:[\w.-]*(?:key|token|auth)|authorization)(?:[._-][\w.-]+)?)\1(\s*[=:]\s*|\s+)(?:"([^"\n]*)"|'([^'\n]*)'|((?:Bearer\s+)?(?:\$\{?[A-Z_][A-Z0-9_]*\}?|[^\s,;{}"']+)))/gi;
const reportSchema = { type: "object", properties: { taskId: { type: "string" }, status: { type: "string" }, evidence: { type: "string" }, summary: { type: "string" } }, required: ["taskId", "status", "evidence", "summary"] };
const rawInput = isRecord(args) ? args : {};
const taskId = isText(rawInput.taskId) ? rawInput.taskId : "";
const issuePath = isText(rawInput.issuePath) ? rawInput.issuePath : "";
const requestedMode = rawInput.mode === undefined ? "plan" : rawInput.mode;
const mode = requestedMode === "plan" || requestedMode === "develop" || requestedMode === "verify" ? requestedMode : "plan";
const blockers = [];
const ledger = [];
const changedPaths = [];
const verificationRecords = [];
const reviewRecords = { spec: [], quality: [] };
let preflightReport = null;
let mappingReport = null;
let latestWriter = null;
let originalRed = null;
let snapshotId = null;
let allowedPaths = null;
let handoffEntered = false;
function addBlocker(message) { if (isText(message)) { const safe = redactError(message); if (!blockers.includes(safe)) blockers.push(safe); } }
function redactSecret(value) { const trimmed = value.trim(); if (ENV_REF.test(trimmed) || /^(?:…|[^\s]{3}…[^\s]{4})$/.test(value)) return value; const bearer = /^(\s*Bearer\s+)(.*?)(\s*)$/i.exec(value); if (bearer) return `${bearer[1]}${redactSecret(bearer[2])}${bearer[3]}`; return value.length < 8 ? "…" : `${value.slice(0, 3)}…${value.slice(-4)}`; }
function redactPromptValue(value, key = "", inheritedSensitive = false) {
  const sensitive = inheritedSensitive || SECRET_KEY.test(key); if (typeof value === "string") return redactError(sensitive ? redactSecret(value) : value);
  if (Array.isArray(value)) return value.map((item) => redactPromptValue(item, key, sensitive));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([name, nested]) => [name, redactPromptValue(nested, name, sensitive)]));
}
function redactError(message) { for (let start = 0; start < message.length; start++) if (message[start] === "{" || message[start] === "[") for (let end = start + 2; end <= message.length; end++) { try { const value = JSON.parse(message.slice(start, end)); if (isRecord(value) || Array.isArray(value)) return `${redactError(message.slice(0, start))}${JSON.stringify(redactPromptValue(value))}${redactError(message.slice(end))}`; } catch {} } return message.replace(KEYED_TEXT, (_, keyQuote, key, separator, doubleValue, singleValue, bareValue) => `${keyQuote}${key}${keyQuote}${separator}${doubleValue !== undefined ? '"' + redactSecret(doubleValue) + '"' : singleValue !== undefined ? "'" + redactSecret(singleValue) + "'" : redactSecret(bareValue)}`).replace(/\b(Bearer\s+)(\$\{?[A-Z_][A-Z0-9_]*\}?|[^\s,;{}()\[\]"']+)/gi, (_, prefix, value) => `${prefix}${redactSecret(value)}`).replace(/\bsk-[A-Za-z0-9][A-Za-z0-9._~+\/=-]{4,}/gi, (value) => redactSecret(value)); }
function plainError(error) {
  const name = isRecord(error) && isText(error.name) ? error.name : "Error";
  const message = isRecord(error) && isText(error.message) ? error.message : isText(error) ? error : "agent call failed";
  return { name: redactError(name), message: redactError(message) };
}
function promptData(value, redact = true) {
  try {
    const text = JSON.stringify(redact ? redactPromptValue(value) : value);
    return text === undefined ? "null" : text;
  } catch {
    return "[unserializable report]";
  }
}
function makePrompt(stage, instruction, confirmation = false) {
  const prompt = [`Task identity: ${taskId}`, `Issue path: ${issuePath}`, `Stage: ${stage}`, instruction];
  if (!confirmation) prompt.push("Return one report with taskId, status, evidence, summary, snapshotId, and applicable stage evidence.");
  return redactError(prompt.concat("No nested agents, commit, push, or publication.").join("\n"));
}
async function invoke(stage, instruction, checkpointOptions = null) {
  const entry = { taskId, stage, status: "pending", result: null };
  ledger.push(entry);
  try {
    const value = await (checkpointOptions ? checkpoint(makePrompt(stage, instruction, true), checkpointOptions) : agent(makePrompt(stage, instruction), { label: stage, schema: reportSchema }));
    if (checkpointOptions) { entry.result = value ?? null; entry.status = value === true ? "approved" : "blocked"; if (value !== true) addBlocker(`${stage}: repair approval was not granted`); return { entry, raw: value, error: null }; }
    if (value === null || value === undefined) {
      entry.status = "missing";
      return { entry, raw: null, error: null };
    }
    entry.status = "returned";
    entry.result = value;
    return { entry, raw: value, error: null };
  } catch (error) {
    entry.status = "error";
    entry.result = plainError(error); if (checkpointOptions) addBlocker(`${stage}: ${entry.result.message}`);
    return { entry, raw: null, error: entry.result };
  }
}
function listField(report, key) {
  if (!has(report, key)) return { present: false, paths: [] };
  if (!Array.isArray(report[key])) return { present: true, error: `${key} must be an array` };
  const paths = [];
  for (const value of report[key]) {
    if (!isText(value)) return { present: true, error: `${key} contains an invalid path` };
    const path = value.trim();
    if (!paths.includes(path)) paths.push(path);
  }
  return { present: true, paths };
}
function samePaths(left, right) { return left.length === right.length && left.every((path) => right.includes(path)); }
function snapshotField(report) {
  const ids = [];
  if (has(report, "snapshotId")) {
    if (!isText(report.snapshotId)) return { error: "snapshotId must be meaningful" };
    ids.push(report.snapshotId.trim());
  }
  if (has(report, "snapshot")) {
    if (!isRecord(report.snapshot)) return { error: "snapshot must be an object" };
    const nested = has(report.snapshot, "id") ? report.snapshot.id : report.snapshot.snapshotId;
    if (nested !== undefined) {
      if (!isText(nested)) return { error: "snapshot identity must be meaningful" };
      ids.push(nested.trim());
    }
  }
  if (ids.length === 0) return { id: null };
  if (!ids.every((id) => id === ids[0])) return { error: "snapshot identity is inconsistent" };
  return { id: ids[0] };
}
function validateReport(result, expectedSnapshot, options = {}) {
  if (result.error) return { ok: false, reason: `agent threw: ${result.error.message}` };
  const report = result.raw;
  if (!isRecord(report)) return { ok: false, reason: "report is null, empty, or malformed" };
  if (report.taskId !== taskId) return { ok: false, reason: "report task identity does not match" };
  if (!isText(report.evidence) || !isText(report.summary)) {
    return { ok: false, reason: "report evidence and summary must be meaningful" };
  }
  if (!isText(report.status)) return { ok: false, reason: "report status is missing" };
  if (!["passed", "failed", "blocked"].includes(report.status)) {
    return { ok: false, reason: "report status is malformed" };
  }
  if (report.status === "blocked") return { ok: false, reason: "report is blocked" };
  if (report.status === "failed" && !options.allowFailed) {
    return { ok: false, reason: "report failed" };
  }
  if (options.allowFailed && has(report, "repairable") && typeof report.repairable !== "boolean") {
    return { ok: false, reason: "repairable flag is malformed" };
  }
  if (options.review && report.blocking === true) {
    return { ok: false, reason: "review has an unresolved blocking finding" };
  }

  const snapshot = snapshotField(report);
  if (snapshot.error) return { ok: false, reason: snapshot.error };
  if (options.requireSnapshot && snapshot.id === null) {
    return { ok: false, reason: "snapshot identity is missing" };
  }
  if (expectedSnapshot !== null && snapshot.id !== expectedSnapshot) {
    return { ok: false, reason: "snapshot identity is stale or mismatched" };
  }

  const declaredAllowed = listField(report, "allowedWrites");
  if (declaredAllowed.error) return { ok: false, reason: declaredAllowed.error };
  let nextAllowed = expectedSnapshot === null ? null : options.allowedPaths ?? null;
  if (declaredAllowed.present) {
    if (nextAllowed !== null && !samePaths(nextAllowed, declaredAllowed.paths)) {
      return { ok: false, reason: "allowed write paths conflict" };
    }
    nextAllowed = declaredAllowed.paths;
  }

  const changed = listField(report, "changedPaths");
  if (changed.error) return { ok: false, reason: changed.error };
  if (options.requireChangedPaths && (!changed.present || changed.paths.length === 0)) {
    return { ok: false, reason: "writer changed paths are missing" };
  }
  if (changed.present && changed.paths.length > 0) {
    if (nextAllowed === null) return { ok: false, reason: "changed paths have no allowed-path boundary" };
    if (!changed.paths.every((path) => nextAllowed.includes(path))) {
      return { ok: false, reason: "changed path is outside the allowed edit surface" };
    }
  }
  return {
    ok: true,
    report,
    status: report.status,
    snapshotId: snapshot.id,
    allowedPaths: nextAllowed,
    changedPaths: changed.present ? changed.paths : [],
  };
}

function accept(result, stage, expectedSnapshot, options = {}) {
  const check = validateReport(result, expectedSnapshot, { ...options, allowedPaths });
  if (!check.ok) {
    if (result.entry.status === "pending" || result.entry.status === "returned") result.entry.status = "blocked";
    addBlocker(`${stage}: ${check.reason}`);
    return null;
  }
  result.entry.status = check.status;
  if (check.allowedPaths !== null) allowedPaths = check.allowedPaths;
  for (const path of check.changedPaths) {
    if (!changedPaths.includes(path)) changedPaths.push(path);
  }
  return check;
}

function rememberWriter(check, label) {
  latestWriter = { label, raw: check.report };
}

function stageEvidence(record, label, round) {
  if (!record || record.raw === null) return { applicable: false, reason: `${label} did not produce a report` };
  const value = { ...record.raw, applicable: true, label, round };
  if (snapshotId !== null) value.snapshotId = snapshotId;
  return value;
}

function reviewEvidence(records, label) {
  const record = records[records.length - 1];
  if (!record || record.raw === null) return { applicable: false, reason: `${label} did not produce a report` };
  return {
    ...record.raw,
    applicable: true,
    label: record.label,
    round: record.round,
    reportPath: isText(record.raw.reportPath) ? record.raw.reportPath : `${label}-${record.round}`,
    snapshotRoot: isText(record.raw.snapshotRoot) ? record.raw.snapshotRoot : `snapshot:${snapshotId}`,
  };
}

function makeReport(status) {
  const snapshot = isRecord(preflightReport?.snapshot) ? { ...preflightReport.snapshot } : {};
  if (snapshotId !== null) {
    snapshot.id = snapshotId;
    snapshot.snapshotId = snapshotId;
  }
  const handoff = {
    artifactPaths: changedPaths.slice(),
    manualChecks: ["Parent acceptance"],
    knownGaps: blockers.slice(),
    issueEvidencePath: issuePath,
  };
  return redactPromptValue({
    status,
    mode,
    taskId,
    issuePath,
    changedPaths: changedPaths.slice(),
    evidence: {
      intake: [preflightReport?.evidence, mappingReport?.evidence].filter(isText).join("; "),
      snapshot: snapshotId === null ? { applicable: false, reason: "preflight did not establish a snapshot" } : snapshot,
      red: stageEvidence(originalRed, "original-red", 0),
      green: stageEvidence(latestWriter, latestWriter?.label ?? "implementation", latestWriter?.round ?? 0),
      verification: verificationRecords.map((record) => stageEvidence(record, record.label, record.round)),
      review: {
        spec: reviewEvidence(reviewRecords.spec, "spec-review"),
        quality: reviewEvidence(reviewRecords.quality, "quality-review"),
      },
      handoff,
    },
    blockers: blockers.slice(),
    forwardLinks: [],
    nextTask: null,
    gitPublication: null,
    handoff,
    ledger,
  });
}

function complete(status) {
  if (!handoffEntered) {
    phase("Handoff");
    handoffEntered = true;
  }
  return makeReport(status);
}

function validateInput() {
  const errors = [];
  if (!isText(rawInput.taskId)) errors.push("taskId is required");
  if (!isText(rawInput.issuePath)) errors.push("issuePath is required");
  if (!(rawInput.mode === undefined || rawInput.mode === "plan" || rawInput.mode === "develop" || rawInput.mode === "verify")) {
    errors.push("mode must be plan, develop, or verify");
  }
  if (mode === "develop" || mode === "verify") {
    const approval = rawInput.parentApproval;
    if (!isRecord(approval) || approval.mode !== mode || approval.source !== "parent" || !isText(approval.evidence)) {
      errors.push(`parent approval for ${mode} must include matching mode, source parent, and evidence`);
    }
  }
  return errors;
}

function recordVerification(result, label, round) { verificationRecords.push({ label, round, raw: result.raw }); }
function recordReview(result, label, round, target) { reviewRecords[target].push({ label, round, raw: result.raw }); }

async function runRound(round) {
  const verification = await invoke(
    `verification-${round}`,
    `Run the verification gate for round ${round} from the exact snapshot. Check every required command and report nonempty evidence, exit codes, hashes, scope, diagnostics, and size checks. This is read-only. Prior writer evidence: ${promptData(latestWriter?.raw)}.`,
  );
  const verificationCheck = accept(verification, `verification-${round}`, snapshotId, { allowFailed: true, requireSnapshot: true });
  recordVerification(verification, `verification-${round}`, round);
  if (verificationCheck === null) return { valid: false, passed: false, repairable: false };

  let reviews;
  try {
    reviews = await parallel([
      () => invoke(
        `spec-review-${round}`,
        `Perform the read-only specification review for round ${round}. Compare the issue and workflow docs with the implementation and verification evidence. Report findings, severity, paths, and evidence. Verification report: ${promptData(verification.raw)}.`,
      ),
      () => invoke(
        `quality-review-${round}`,
        `Perform the read-only quality review for round ${round}. Check boundaries, tests, redaction, maintainability, and repository standards. Report findings, severity, paths, and evidence. Verification report: ${promptData(verification.raw)}.`,
      ),
    ]);
  } catch (error) {
    addBlocker(`reviews-${round}: parallel review call failed: ${plainError(error).message}`);
    return { valid: false, passed: false, repairable: false };
  }

  const spec = accept(reviews[0], `spec-review-${round}`, snapshotId, { allowFailed: true, requireSnapshot: true, review: true });
  recordReview(reviews[0], `spec-review-${round}`, round, "spec");
  const quality = accept(reviews[1], `quality-review-${round}`, snapshotId, { allowFailed: true, requireSnapshot: true, review: true });
  recordReview(reviews[1], `quality-review-${round}`, round, "quality");
  if (spec === null || quality === null) return { valid: false, passed: false, repairable: false };

  const failed = [verificationCheck, spec, quality].filter((check) => check.status === "failed");
  return {
    valid: true,
    passed: failed.length === 0,
    repairable: failed.length > 0 && failed.every((check) => check.report.repairable === true),
  };
}

phase("Intake");
const inputErrors = validateInput();
if (inputErrors.length > 0) {
  for (const error of inputErrors) addBlocker(error);
  return makeReport("blocked");
}

const preflight = await invoke(
  "preflight",
  "Perform read-only intake and snapshot validation. Confirm the named issue, baseline, dependencies and tools without installing, exact edit surfaces, and matching source/copy manifests. Return the snapshot identity and allowed writes.",
);
const preflightCheck = accept(preflight, "preflight", null, { requireSnapshot: true });
if (preflightCheck === null) return complete("blocked");
preflightReport = preflightCheck.report;
snapshotId = preflightCheck.snapshotId;
allowedPaths = preflightCheck.allowedPaths;

const mapping = await invoke(
  "mapping",
  `Build the read-only task map and claim proposal. Confirm prerequisites, acceptance commands, evidence paths, line limits, and exact allowed surfaces. The preflight report is ${promptData(preflight.raw)}.`,
);
const mappingCheck = accept(mapping, "mapping", snapshotId, { requireSnapshot: true });
if (mappingCheck === null) return complete("blocked");
mappingReport = mappingCheck.report;

if (mode === "plan") return complete("planned");
phase("Execute");

if (mode === "develop") {
  const testWriter = await invoke(
    "test-writer",
    `Prepare only the permitted focused test artifact for the task. Preserve existing assertions, report exact changed paths, and do not touch production source. The map is ${promptData(mapping.raw)}.`,
  );
  const testWriterCheck = accept(testWriter, "test-writer", snapshotId, { requireSnapshot: true, requireChangedPaths: true });
  if (testWriterCheck === null) return complete("blocked");
  rememberWriter(testWriterCheck, "test-writer");

  originalRed = await invoke(
    "original-red",
    `Run the original focused acceptance against the same snapshot before production edits. Prove the genuine requested RED with a nonzero exit code and nonempty output; do not remove production code to manufacture a failure. Test-writer report: ${promptData(testWriter.raw)}.`,
  );
  const redCheck = accept(originalRed, "original-red", snapshotId, { requireSnapshot: true });
  if (redCheck === null) return complete("blocked");
  if (redCheck.report.red !== true || typeof redCheck.report.exitCode !== "number" || redCheck.report.exitCode === 0) {
    addBlocker("original-red: genuine RED evidence is missing");
    return complete("blocked");
  }

  const implementation = await invoke(
    "implementation",
    `Make the minimum implementation on the exact approved surfaces after the original RED. Preserve unrelated work, use no publication action, and report changed paths and focused GREEN evidence. RED report: ${promptData(originalRed.raw)}.`,
  );
  const implementationCheck = accept(implementation, "implementation", snapshotId, { requireSnapshot: true, requireChangedPaths: true });
  if (implementationCheck === null) return complete("blocked");
  rememberWriter(implementationCheck, "implementation");
}

let roundResult = await runRound(0);
let round = 0;
while (roundResult.valid && !roundResult.passed) {
  if (mode !== "develop") {
    addBlocker("failed verification or review cannot be repaired in verify mode");
    return complete("blocked");
  }
  if (!roundResult.repairable) {
    addBlocker("failed verification or review is not explicitly repairable");
    return complete("blocked");
  }
  if (round >= 2) {
    addBlocker("repair limit reached after two rounds");
    return complete("blocked");
  }
  round += 1; const approval = await invoke(`repair-${round}-approval`, `Approve repair round ${round}. Only an explicit true answer authorizes this repair. Current context: ${promptData({ round, allowedPaths, snapshotId, verification: verificationRecords[verificationRecords.length - 1], spec: reviewRecords.spec[reviewRecords.spec.length - 1], quality: reviewRecords.quality[reviewRecords.quality.length - 1] }, true)}.`, { kind: "confirm", default: false, headless: "abort" });
  if (approval.raw !== true) return complete("blocked");
  const repair = await invoke(
    `repair-${round}-writer`,
    `Repair only the reported in-scope verification or review findings for round ${round}. Foreground checkpoint approval is the only repair authority; parentApproval does not substitute. Do not invent another authority, expand scope, or publish. Previous verification and reviews are ${promptData({ verification: verificationRecords, reviews: reviewRecords })}.`,
  );
  const repairCheck = accept(repair, `repair-${round}-writer`, snapshotId, { requireSnapshot: true, requireChangedPaths: true });
  if (repairCheck === null) return complete("blocked");
  rememberWriter(repairCheck, `repair-${round}-writer`);
  roundResult = await runRound(round);
}

if (!roundResult.valid || !roundResult.passed) return complete("blocked");
return complete("ready_for_acceptance");
