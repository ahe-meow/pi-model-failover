import type { FailoverReason, TargetState } from "./types.js";

export const LADDER_MS: readonly number[] = Object.freeze([60_000, 300_000, 900_000, 3_600_000]);

const MAX_COOLDOWN_LEVEL = LADDER_MS.length;

function cloneState(state: TargetState): TargetState {
  return {
    ...state,
    lastFailure: state.lastFailure ? { ...state.lastFailure } : null,
  };
}

function zeroState(): TargetState {
  return {
    consecutiveFailures: 0,
    cooldownLevel: 0,
    cooldownUntil: null,
    manualRecovery: false,
    lastFailure: null,
  };
}

export function cooldownFor(level: number): number {
  if (level <= 0) return 0;
  const index = Math.min(Math.floor(level), MAX_COOLDOWN_LEVEL) - 1;
  return LADDER_MS[index] ?? 0;
}

export function backoffMs(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, 60_000);
}

export function applyFailure(state: TargetState, reason: FailoverReason, now: number): TargetState {
  const cooldownLevel = Math.min(state.cooldownLevel + 1, MAX_COOLDOWN_LEVEL);
  return {
    ...cloneState(state),
    consecutiveFailures: state.consecutiveFailures + 1,
    cooldownLevel,
    cooldownUntil: new Date(now + cooldownFor(cooldownLevel)).toISOString(),
    manualRecovery: false,
    lastFailure: { ts: new Date(now).toISOString(), reason },
  };
}

export function applySuccess(_state: TargetState): TargetState {
  return zeroState();
}

export function applyManualRecovery(
  state: TargetState,
  now: number,
  reason: FailoverReason,
): TargetState {
  return {
    ...cloneState(state),
    manualRecovery: true,
    lastFailure: { ts: new Date(now).toISOString(), reason },
  };
}

export function reset(): TargetState {
  return zeroState();
}

export function isExcluded(state: TargetState | undefined, now: number): boolean {
  if (state === undefined) return false;
  if (state.manualRecovery) return true;
  return state.cooldownUntil !== null && Date.parse(state.cooldownUntil) > now;
}
