import type { FailoverReason, TargetRef } from "../domain/types.js";
import { S } from "../strings.js";

export type FallbackNotice = {
  from: TargetRef;
  to: TargetRef | null;
  reason: FailoverReason;
};

export interface FooterState {
  currentTarget: TargetRef | null;
  latestFallback: FallbackNotice | null;
}

export interface FooterStatusValues {
  current: string;
  fallback: string;
}

export const FOOTER_STATUS_KEYS = {
  current: "failover-current",
  fallback: "failover-fallback",
} as const;

export const emptyFooterState: FooterState = {
  currentTarget: null,
  latestFallback: null,
};

export function createFooterState(): FooterState {
  return { currentTarget: null, latestFallback: null };
}

export function updateCurrentTarget(state: FooterState, target: TargetRef): FooterState {
  return { ...state, currentTarget: target };
}

export function updateFallback(state: FooterState, notice: FallbackNotice): FooterState {
  return notice.to === null || notice.reason === "manual"
    ? state
    : { ...state, latestFallback: notice };
}

export function footerStatusValues(state: FooterState): FooterStatusValues {
  const fallback = state.latestFallback;
  return {
    current: S.footer.current(state.currentTarget ?? S.history.none),
    fallback: S.footer.fallback(fallback?.to ?? S.history.none, fallback?.reason),
  };
}
