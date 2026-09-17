export type ServerQualitySettings = {
  enabled: boolean;
  ttft: boolean;
  noProgress: boolean;
};

export type ServerQualityOverride = Partial<ServerQualitySettings>;
export type ServerQualitySignal = "ttft" | "no-progress";

export function resolveServerQuality(
  global: ServerQualitySettings,
  override?: ServerQualityOverride,
): ServerQualitySettings {
  return {
    enabled: override?.enabled ?? global.enabled,
    ttft: override?.ttft ?? global.ttft,
    noProgress: override?.noProgress ?? global.noProgress,
  };
}

export function isServerQualityEnabled(
  settings: ServerQualitySettings,
  signal: ServerQualitySignal,
): boolean {
  return settings.enabled && (signal === "ttft" ? settings.ttft : settings.noProgress);
}
