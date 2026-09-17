import { describe, expect, it } from "vitest";
import {
  isServerQualityEnabled,
  resolveServerQuality,
  type ServerQualitySettings,
} from "../../src/domain/serverQuality.js";

describe("server quality", () => {
  const enabled: ServerQualitySettings = { enabled: true, ttft: true, noProgress: true };

  it("resolves a partial override without treating false as absent", () => {
    expect(resolveServerQuality(enabled, { enabled: false, ttft: false })).toEqual({
      enabled: false,
      ttft: false,
      noProgress: true,
    });
    expect(resolveServerQuality(enabled, { noProgress: false })).toEqual({
      enabled: true,
      ttft: true,
      noProgress: false,
    });
  });

  it("returns a fresh complete settings object when there is no override", () => {
    const resolved = resolveServerQuality(enabled);
    expect(resolved).toEqual(enabled);
    expect(resolved).not.toBe(enabled);
  });

  it("requires both the master and selected signal to be enabled", () => {
    expect(isServerQualityEnabled(enabled, "ttft")).toBe(true);
    expect(isServerQualityEnabled(enabled, "no-progress")).toBe(true);
    expect(isServerQualityEnabled({ ...enabled, ttft: false }, "ttft")).toBe(false);
    expect(isServerQualityEnabled({ ...enabled, enabled: false }, "no-progress")).toBe(false);
  });
});
