import { describe, expect, it } from "vitest";
import {
  applyFailure,
  applyManualRecovery,
  applySuccess,
  backoffMs,
  cooldownFor,
  isExcluded,
  reset,
} from "../../src/domain/cooldown.js";
import type { TargetState } from "../../src/domain/types.js";

const zero = reset();

function state(overrides: Partial<TargetState> = {}): TargetState {
  return { ...zero, ...overrides };
}

describe("cooldown", () => {
  it("C13: cooldown ladder 1/5/15/60", () => {
    expect([1, 2, 3, 4, 5].map(cooldownFor)).toEqual([
      60_000, 300_000, 900_000, 3_600_000, 3_600_000,
    ]);

    let current = zero;
    for (let i = 1; i <= 5; i++) current = applyFailure(current, "http-503", 0);

    expect(current.cooldownLevel).toBe(4);
    expect(current.consecutiveFailures).toBe(5);
    expect(current.cooldownUntil).toBe(new Date(3_600_000).toISOString());
  });

  it("C13: cooldown level zero has no duration", () => {
    expect(cooldownFor(0)).toBe(0);
    expect(cooldownFor(4)).toBe(3_600_000);
    expect(cooldownFor(100)).toBe(3_600_000);
  });

  it("C13: success resets level and cooldown", () => {
    const failed = applyFailure(zero, "network", 0);
    const recovered = applySuccess(failed);

    expect(recovered).toEqual(zero);
    expect(recovered).not.toBe(zero);
    expect(failed).not.toEqual(zero);
  });

  it("C9: manual recovery remains excluded after cooldown time", () => {
    const stateWithManualRecovery = applyManualRecovery(zero, 0, "persistent");

    expect(stateWithManualRecovery.manualRecovery).toBe(true);
    expect(stateWithManualRecovery.lastFailure).toEqual({
      ts: new Date(0).toISOString(),
      reason: "persistent",
    });
    expect(isExcluded(stateWithManualRecovery, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("treats a cooldown as active only before its end timestamp", () => {
    const failed = applyFailure(zero, "http-429", 1_000);
    const cooldownEnd = Date.parse(failed.cooldownUntil ?? "");

    expect(isExcluded(undefined, cooldownEnd)).toBe(false);
    expect(isExcluded(failed, cooldownEnd - 1)).toBe(true);
    expect(isExcluded(failed, cooldownEnd)).toBe(false);
    expect(isExcluded(failed, cooldownEnd + 1)).toBe(false);
  });

  it("caps in-request backoff at 60 seconds", () => {
    expect([0, 1, 2, 10].map(backoffMs)).toEqual([1_000, 2_000, 4_000, 60_000]);
  });

  it("keeps failure and manual-recovery inputs immutable", () => {
    const original = state({
      consecutiveFailures: 2,
      cooldownLevel: 2,
      cooldownUntil: new Date(300_000).toISOString(),
      manualRecovery: false,
      lastFailure: { ts: new Date(10).toISOString(), reason: "network" },
    });
    const snapshot = structuredClone(original);

    const failed = applyFailure(original, "http-500", 20);
    const manual = applyManualRecovery(original, 30, "persistent");

    expect(original).toEqual(snapshot);
    expect(failed).not.toBe(original);
    expect(failed.lastFailure).not.toBe(original.lastFailure);
    expect(manual).not.toBe(original);
    expect(manual.lastFailure).not.toBe(original.lastFailure);
  });

  it("preserves the prior cooldown level while entering manual recovery", () => {
    const original = state({
      consecutiveFailures: 3,
      cooldownLevel: 3,
      cooldownUntil: new Date(900_000).toISOString(),
    });

    expect(applyManualRecovery(original, 1_000, "persistent")).toEqual({
      consecutiveFailures: 3,
      cooldownLevel: 3,
      cooldownUntil: new Date(900_000).toISOString(),
      manualRecovery: true,
      lastFailure: { ts: new Date(1_000).toISOString(), reason: "persistent" },
    });
  });

  it("returns fresh zero states from reset", () => {
    const first = reset();
    const second = reset();

    expect(first).toEqual({
      consecutiveFailures: 0,
      cooldownLevel: 0,
      cooldownUntil: null,
      manualRecovery: false,
      lastFailure: null,
    });
    expect(first).not.toBe(second);
  });
});
