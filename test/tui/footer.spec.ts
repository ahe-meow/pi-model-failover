import { describe, expect, it } from "vitest";
import type { TargetRef } from "../../src/domain/types.js";
import {
  createFooterState,
  emptyFooterState,
  type FallbackNotice,
  footerStatusValues,
  updateCurrentTarget,
  updateFallback,
} from "../../src/tui/footer.js";

const fallback = (to: TargetRef | null): FallbackNotice => ({
  from: "relay-a/coding",
  to,
  reason: "http-503",
});

describe("Footer status state", () => {
  it("starts empty and formats native status placeholders", () => {
    const state = createFooterState();

    expect(state).toEqual(emptyFooterState);
    expect(footerStatusValues(state)).toEqual({
      current: "-",
      fallback: "-",
    });
  });

  it("keeps the most recent physical Target attempt", () => {
    let state = createFooterState();
    state = updateCurrentTarget(state, "relay-a/coding");
    state = updateCurrentTarget(state, "relay-b/coding");

    expect(state.currentTarget).toBe("relay-b/coding");
    expect(footerStatusValues(state).current).toBe("relay-b/coding");
  });

  it("formats a real fallback with its destination and reason", () => {
    const state = updateFallback(createFooterState(), fallback("relay-b/coding"));

    expect(state.latestFallback).toEqual(fallback("relay-b/coding"));
    expect(footerStatusValues(state).fallback).toBe("relay-b/coding <- http-503");
  });

  it("retains a real fallback when final or manual notices arrive", () => {
    const state = updateFallback(createFooterState(), fallback("relay-b/coding"));
    const finalNotice = fallback(null);
    const manualNotice: FallbackNotice = {
      from: "relay-b/coding",
      to: "relay-c/coding",
      reason: "manual",
    };

    const afterFinal = updateFallback(state, finalNotice);
    const afterManual = updateFallback(afterFinal, manualNotice);

    expect(afterFinal).toBe(state);
    expect(afterManual).toBe(state);
    expect(footerStatusValues(afterManual).fallback).toBe("relay-b/coding <- http-503");
  });
});
