import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflowPath = new URL("../../workflows/task-lifecycle.js", import.meta.url);
const task = {
  taskId: "T1",
  issuePath: ".scratch/workflow-standard/issues/01-reusable-workflow.md",
  mode: "develop",
  parentApproval: { mode: "develop", source: "parent", evidence: "approved" },
};
const snapshot = {
  id: "snap-1",
  root: "/tmp/snap-1",
  sourceManifest: "source.sha256",
  copyManifest: "copy.sha256",
  matchingManifestDiff: "clean",
};
const reply = (extra: Record<string, unknown> = {}) => ({
  taskId: task.taskId,
  status: "passed",
  evidence: "recorded evidence",
  summary: "stage passed",
  snapshotId: snapshot.id,
  ...extra,
});
function successfulReplies() {
  return {
    preflight: reply({
      allowedWrites: ["test/workflows/task-lifecycle.spec.ts", "workflows/task-lifecycle.js"],
      dependencies: ["vitest"],
      changedLines: 200,
      snapshot,
    }),
    mapping: reply({
      proposal: "bounded execution",
      acceptance: ["npm run check"],
      existingEvidence: true,
      allowedWrites: ["test/workflows/task-lifecycle.spec.ts", "workflows/task-lifecycle.js"],
    }),
    "test-writer": reply({ changedPaths: ["test/workflows/task-lifecycle.spec.ts"] }),
    "original-red": reply({ red: true, exitCode: 1 }),
    implementation: reply({ changedPaths: ["workflows/task-lifecycle.js"] }),
    "verification-0": reply({}),
    "spec-review-0": reply({ reviewer: "spec", summary: "spec retained" }),
    "quality-review-0": reply({ reviewer: "quality", summary: "quality retained" }),
  };
}
async function run(
  args: unknown,
  responses: Record<string, unknown>,
  decisions: unknown[] | null = [],
) {
  const source = await readFile(workflowPath, "utf8");
  const prefix = "export const meta = ";
  expect(source.startsWith(prefix)).toBe(true);
  expect(source.match(/\bexport\b/g) ?? []).toHaveLength(1);
  const end = source.indexOf("};", prefix.length);
  expect(end).toBeGreaterThan(prefix.length);
  const body = source.slice(end + 2);
  const calls: Array<{ label: string; prompt: string }> = [];
  const confirmations: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const events: string[] = [];
  const phases: string[] = [];
  const agent = async (prompt: string, options: { label?: string } = {}) => {
    const label = options.label ?? "missing-label";
    events.push(label);
    calls.push({ label, prompt });
    const value = Object.hasOwn(responses, label) ? responses[label] : null;
    if (value instanceof Error) throw value;
    return value;
  };
  const parallel = async (thunks: Array<() => Promise<unknown>>) =>
    Promise.all(thunks.map((thunk) => thunk()));
  const checkpoint = async (prompt: string, options: Record<string, unknown>) => {
    const round = confirmations.push({ prompt, options });
    events.push(`confirm-${round}`);
    const value = await decisions?.[round - 1];
    events.push(`decision-${round}`);
    if (value instanceof Error) throw value;
    return value;
  };
  const execute = new Function(
    "agent",
    "parallel",
    "phase",
    "log",
    "args",
    "checkpoint",
    `return (async () => {${body}})();`,
  );
  const report = await execute(
    agent,
    parallel,
    (name: string) => phases.push(name),
    () => {},
    args,
    decisions === null ? undefined : checkpoint,
  );
  return { report, calls, phases, confirmations, events };
}
function repairReplies(findings?: string[]) {
  const responses: Record<string, unknown> = successfulReplies();
  for (let round = 0; round <= 2; round++) {
    responses[`verification-${round}`] = reply({
      status: round === 1 && findings ? "passed" : "failed",
      repairable: true,
      summary: `verify ${round}`,
      findings: round === 0 && findings ? findings : [`verification finding ${round}`],
    });
    responses[`spec-review-${round}`] = reply({ summary: `spec ${round}` });
    responses[`quality-review-${round}`] = reply({ summary: `quality ${round}` });
    if (round > 0) responses[`repair-${round}-writer`] = responses.implementation;
  }
  return responses;
}

describe("task lifecycle workflow", () => {
  it("runs gated develop stages in order and hands off without publication", async () => {
    const result = await run(task, successfulReplies());
    expect(result.calls.map(({ label }) => label)).toEqual([
      "preflight",
      "mapping",
      "test-writer",
      "original-red",
      "implementation",
      "verification-0",
      "spec-review-0",
      "quality-review-0",
    ]);
    expect(result.phases).toEqual(["Intake", "Execute", "Handoff"]);
    expect(result.report.status).toBe("ready_for_acceptance");
    expect(result.report.nextTask).toBeNull();
    expect(result.report.gitPublication).toBeNull();
    expect(result.report.ledger.map(({ stage }: { stage: string }) => stage)).toEqual(
      result.calls.map(({ label }) => label),
    );
    expect(
      result.calls.every(({ prompt }) =>
        prompt.includes("No nested agents, commit, push, or publication"),
      ),
    ).toBe(true);
  });

  it("blocks invalid approval before any writer call", async () => {
    const result = await run({ ...task, parentApproval: undefined }, {});
    expect(result.report.status).toBe("blocked");
    expect(result.calls).toHaveLength(0);
    expect(result.report.blockers[0]).toMatch(/approval/i);
  });

  it.each([
    null,
    "",
    { taskId: task.taskId, status: "passed" },
    new Error("agent failed"),
    reply({ status: "blocked", summary: "preflight blocked" }),
  ])("stops on preflight report %j before dependent stages", async (bad) => {
    const result = await run(task, { preflight: bad });
    expect(result.report.status).toBe("blocked");
    expect(result.calls.map(({ label }) => label)).toEqual(["preflight"]);
    expect(result.report.ledger).toHaveLength(1);
    expect(result.report.ledger[0]).toMatchObject({ taskId: task.taskId, stage: "preflight" });
  });

  it("caps repairable failures at two rounds and retains both reviews", async () => {
    const responses: Record<string, unknown> = successfulReplies();
    for (let round = 0; round <= 2; round++) {
      responses[`verification-${round}`] = reply({
        status: "failed",
        repairable: true,
        summary: `verify ${round}`,
      });
      responses[`spec-review-${round}`] = reply({ reviewer: "spec", summary: `spec ${round}` });
      responses[`quality-review-${round}`] = reply({
        reviewer: "quality",
        summary: `quality ${round}`,
      });
    }
    responses["repair-1-writer"] = reply({ changedPaths: ["workflows/task-lifecycle.js"] });
    responses["repair-2-writer"] = reply({ changedPaths: ["workflows/task-lifecycle.js"] });
    const result = await run(task, responses, [true, true]);
    expect(result.report.status).toBe("blocked");
    expect(
      result.calls.filter(({ label }) => label.endsWith("-writer")).map(({ label }) => label),
    ).toEqual(["test-writer", "repair-1-writer", "repair-2-writer"]);
    expect(result.calls.some(({ label }) => label === "repair-3-writer")).toBe(false);
    expect(result.confirmations).toHaveLength(2);
    for (const round of [1, 2]) {
      const index = result.events.indexOf(`repair-${round}-writer`);
      expect(result.events.slice(index - 2, index)).toEqual([
        `confirm-${round}`,
        `decision-${round}`,
      ]);
    }
    expect(result.report.evidence.review.spec.summary).toBe("spec 2");
    expect(result.report.evidence.review.quality.summary).toBe("quality 2");
  });

  it("verifies existing evidence read-only and never invokes a writer", async () => {
    const responses = successfulReplies();
    const result = await run(
      {
        ...task,
        mode: "verify",
        parentApproval: { mode: "verify", source: "parent", evidence: "approved" },
      },
      responses,
    );
    expect(result.report.status).toBe("ready_for_acceptance");
    expect(result.calls.map(({ label }) => label)).toEqual([
      "preflight",
      "mapping",
      "verification-0",
      "spec-review-0",
      "quality-review-0",
    ]);
    expect(result.calls.some(({ label }) => label.includes("writer"))).toBe(false);
  });
  it.each([false, undefined, null, "true", 1, {}, [], new Error("foreground UI unavailable")])(
    "denies repair for checkpoint answer or error %j despite initial parentApproval",
    async (decision) => {
      const result = await run(task, repairReplies(), [decision]);
      expect(result.report.status).toBe("blocked");
      expect(result.report.blockers.join(" ")).toMatch(/repair-1-approval/);
      expect(result.confirmations).toHaveLength(1);
      expect(result.calls.some(({ label }) => label.startsWith("repair-"))).toBe(false);
      expect(result.calls.some(({ label }) => label === "verification-1")).toBe(false);
      const last = result.report.ledger.at(-1);
      expect(last).toMatchObject({
        stage: "repair-1-approval",
        status: decision instanceof Error ? "error" : "blocked",
        result: decision instanceof Error ? { message: decision.message } : (decision ?? null),
      });
    },
  );
  it("blocks with a reason when the checkpoint API is unavailable", async () => {
    const result = await run(task, repairReplies(), null);
    expect(result.report.status).toBe("blocked");
    expect(result.report.blockers.join(" ")).toMatch(/repair-1-approval/);
    expect(result.calls.some(({ label }) => label.startsWith("repair-"))).toBe(false);
    const last = result.report.ledger.at(-1);
    expect(last).toMatchObject({ stage: "repair-1-approval", status: "error" });
  });
  it("requires explicit true with scoped current evidence before dispatching its writer", async () => {
    const responses = repairReplies();
    responses["verification-1"] = reply();
    const result = await run(task, responses, [true]);
    expect(result.report.status).toBe("ready_for_acceptance");
    expect(result.confirmations).toHaveLength(1);
    const confirmation = result.confirmations[0];
    expect(confirmation?.options).toEqual({ kind: "confirm", default: false, headless: "abort" });
    for (const context of [
      task.taskId,
      task.issuePath,
      '"round":1',
      "test/workflows/task-lifecycle.spec.ts",
      "workflows/task-lifecycle.js",
      snapshot.id,
      "verify 0",
      "verification finding 0",
      "spec 0",
      "quality 0",
    ]) {
      expect(confirmation?.prompt).toContain(context);
    }
    const index = result.events.indexOf("repair-1-writer");
    expect(index).toBeGreaterThan(0);
    expect(result.events.slice(index - 2, index)).toEqual(["confirm-1", "decision-1"]);
    expect(
      result.report.ledger.find(({ stage }: { stage: string }) => stage === "repair-1-approval"),
    ).toMatchObject({ taskId: task.taskId, status: "approved", result: true });
    expect(result.report.gitPublication).toBeNull();
  });
  it("redacts open-ended verification data from repair approval prompts", async () => {
    const responses = repairReplies();
    responses["verification-0"] = Object.assign(reply({ status: "failed", repairable: true }), {
      apiKey: "sk-live-secret-1234",
      Authorization: "Bearer sk-live-token-5678",
      token: "sk-live-token-5678",
    });
    responses["verification-1"] = reply();
    const result = await run(task, responses, [true]);
    expect(result.report.status).toBe("ready_for_acceptance");
    expect(result.confirmations).toHaveLength(1);
    const prompt = result.confirmations[0]?.prompt ?? "";
    expect(prompt).not.toContain("sk-live-secret-1234");
    expect(prompt).not.toContain("sk-live-token-5678");
    expect(prompt).toContain("sk-…1234");
  });
  it("redacts checkpoint exceptions from the returned report", async () => {
    const secret = "sk-live-error-9012",
      bearerToken = "sk-standalone-bearer-9012";
    const result = await run(task, repairReplies(), [new Error(`authorization ${secret}`)]);
    const standalone = await run(task, repairReplies(), [new Error(`Bearer ${bearerToken}`)]);
    for (const text of [JSON.stringify(result.report), result.report.blockers.join(" ")])
      for (const value of [secret, `Bearer ${bearerToken}`]) expect(text).not.toContain(value);
    const recorded = result.report.ledger.at(-1);
    expect(recorded).toMatchObject({ stage: "repair-1-approval", status: "error" });
    expect(recorded?.result?.message).not.toBe(`authorization ${secret}`);
    expect(recorded?.result?.message).not.toContain(`Bearer ${bearerToken}`);
    expect(recorded?.result?.message).toContain("…");
    expect(JSON.stringify(standalone.report)).not.toContain(bearerToken);
    expect(standalone.report.blockers.join(" ")).not.toContain(bearerToken);
    expect(standalone.report.ledger.at(-1)?.result?.message).toContain("Bearer sk-…9012");
  });
  it("redacts ordinary verification evidence from repair approval context and report", async () => {
    const responses = repairReplies();
    responses["verification-0"] = Object.assign(reply({ status: "failed", repairable: true }), {
      evidence: "apiKey=sk-embedded-secret-0000",
      summary: "token: sk-embedded-token-0001",
      findings: ["authorization sk-embedded-auth-0002"],
      apiKey: { value: "sk-nested-secret-1234", list: ["sk-array-secret-5678", "sk-raw…secret"] },
    });
    responses["verification-1"] = reply();
    const result = await run(task, responses, [true]);
    const serialized = JSON.stringify(result.report);
    const prompt = result.confirmations[0]?.prompt ?? "";
    const reviewLabels = /^(?:spec|quality)-review-0$|^repair-1-writer$/;
    const promptCalls = result.calls.filter(({ label }) => reviewLabels.test(label));
    expect(promptCalls.some(({ label }) => label === "repair-1-writer")).toBe(true);
    for (const text of [serialized, prompt, ...promptCalls.map(({ prompt: value }) => value)]) {
      for (const secret of [
        "sk-embedded-secret-0000",
        "sk-embedded-token-0001",
        "sk-embedded-auth-0002",
        "sk-nested-secret-1234",
        "sk-array-secret-5678",
        "sk-raw…secret",
      ])
        expect(text).not.toContain(secret);
      for (const safe of ["sk-…0000", "sk-…1234", "sk-…5678"]) expect(text).toContain(safe);
      expect(text).toContain("sk-…cret");
    }
    expect(prompt).toContain("sk-…0000");
  });
  it("redacts keyed verification in review prompts", async () => {
    const { calls: c } = await run(task, repairReplies(["apiKey=sk-agent-prompt-1122"]), [false]);
    for (const { prompt } of c.filter((x) => /^(?:spec|quality)-review-0$/.test(x.label)))
      expect(!prompt.includes("sk-agent-prompt-1122") && prompt.includes("sk-…1122")).toBe(true);
    const sensitiveTask = { ...task, taskId: "T1 apiKey=sk-task-id-1122" };
    sensitiveTask.issuePath = "issue.md?token=sk-issue-path-3344";
    const responses = repairReplies(["apiKey=sk-agent-prompt-1122"]);
    for (const value of Object.values(responses))
      if (value && typeof value === "object")
        (value as Record<string, unknown>).taskId = sensitiveTask.taskId;
    const { calls, confirmations } = await run(sensitiveTask, responses, [true]);
    expect(calls.some(({ label }) => label === "repair-1-writer")).toBe(true);
    for (const text of [...calls, ...confirmations].map(({ prompt }) => prompt)) {
      expect(text).not.toMatch(/sk-task-id-1122|sk-issue-path-3344/);
      expect(text).toContain("sk-…1122");
      expect(text).toContain("sk-…3344");
      if (/spec-review-0|quality-review-0|repair-1-approval|repair-1-writer/.test(text))
        expect(!text.includes("sk-agent-prompt-1122") && text.includes("sk-…1122")).toBe(true);
    }
  });
  it("preserves environment placeholders in approval prompts", async () => {
    const f = ["apiKey=$" + "{API_KEY}", "$TOKEN", "authorization=sk-confirmation-secret-3344"];
    const { prompt = "" } = (await run(task, repairReplies(f), [true])).confirmations[0] ?? {};
    expect(f.every((v, i) => prompt.includes(v) === i < 2)).toBe(true);
  });
  it("redacts JSON checkpoint errors from the report and ledger", async () => {
    const errorMessage =
      '[worker] {"apiKey":["plain-value",{"nested":"plain-json"}]} Bearer $' + "{API_KEY} sk-abcde";
    const result = await run(task, repairReplies(), [new Error(errorMessage)]);
    expect(JSON.stringify(result.report)).not.toContain("sk-abcde");
    expect(JSON.stringify(result.report)).not.toContain(JSON.stringify(errorMessage));
    const recorded = result.report.ledger.at(-1),
      r = result.report;
    expect(recorded).toMatchObject({ stage: "repair-1-approval", status: "error" });
    expect(recorded?.result?.message).toContain("Bearer $" + "{API_KEY}");
    expect(recorded?.result?.message).toContain("sk-…bcde");
    for (const text of [JSON.stringify(r), r.blockers.join(" "), recorded?.result?.message ?? ""]) {
      expect(text).not.toMatch(/plain-value|plain-json|sk-abcde/);
      for (const safe of ["pla…alue", "pla…json", "sk-…bcde"]) expect(text).toContain(safe);
    }
  });
  it("redacts secrets in non-boolean checkpoint decisions", async () => {
    const result = await run(task, repairReplies(), [{ apiKey: "sk-decision-secret-8899" }]);
    expect(JSON.stringify(result.report)).not.toContain("sk-decision-secret-8899");
    expect(result.report.ledger.at(-1)?.result).toMatchObject({ apiKey: "sk-…8899" });
  });
  it("keeps the foreground repair approval prompt confirmation-only", async () => {
    const responses = repairReplies();
    responses["verification-1"] = reply();
    const result = await run(task, responses, [true]);
    expect(result.report.status).toBe("ready_for_acceptance");
    expect(result.confirmations).toHaveLength(1);
    const confirmation = result.confirmations[0];
    expect(confirmation?.prompt).toContain("Approve repair round 1");
    expect(confirmation?.prompt).toContain("Only an explicit true answer authorizes this repair");
    expect(confirmation?.prompt).not.toContain("Return one report");
    expect(confirmation?.options).toEqual({ kind: "confirm", default: false, headless: "abort" });
  });
  it.each([false, undefined])("requires a separate second-round decision: %j", async (second) => {
    const result = await run(task, repairReplies(), [true, second]);
    expect(result.report.status).toBe("blocked");
    expect(result.confirmations).toHaveLength(2);
    expect(
      result.calls.filter(({ label }) => label.startsWith("repair-")).map(({ label }) => label),
    ).toEqual(["repair-1-writer"]);
    expect(result.calls.some(({ label }) => label === "verification-2")).toBe(false);
    expect(result.report.blockers.join(" ")).toMatch(/repair-2-approval/);
    for (const context of `"round":2|verify 1|verification finding 1|spec 1|quality 1`.split("|")) {
      expect(result.confirmations[1]?.prompt).toContain(context);
    }
    expect(result.confirmations[1]?.prompt).not.toContain("verification finding 0");
    const ledger = result.report.ledger;
    const decisions = ledger.filter(({ stage }: { stage: string }) => stage.endsWith("-approval"));
    const values = decisions.map(({ result }: { result: unknown }) => result);
    expect(values).toEqual([true, second ?? null]);
  });
  it.each(["plan", "verify"])(
    "never confirms or repairs failed findings in %s mode",
    async (mode) => {
      const input = { ...task, mode, parentApproval: { ...task.parentApproval, mode } };
      const result = await run(input, repairReplies(), [true, true]);
      expect(result.report.status).toBe(mode === "plan" ? "planned" : "blocked");
      expect(result.confirmations).toHaveLength(0);
      expect(result.calls.some(({ label }) => /writer|implementation/.test(label))).toBe(false);
    },
  );
});
