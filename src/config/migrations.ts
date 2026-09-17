export const CONFIG_VERSION = 2;
export const STATE_VERSION = 1;

type ConfigDocument = Record<string, unknown>;
type Migration = (raw: unknown) => ConfigDocument;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const migrateConfigV1 = (raw: unknown): ConfigDocument => {
  if (!isRecord(raw)) return {};
  if (raw.version !== 1) return structuredClone(raw);
  const next = structuredClone(raw);
  const settings = isRecord(next.settings) ? next.settings : {};
  const legacyServerQuality = isRecord(settings.serverQuality) ? settings.serverQuality : {};
  delete settings.ttftAction;
  settings.serverQuality = {
    enabled: true,
    ttft: true,
    noProgress: true,
    ...legacyServerQuality,
  };
  next.settings = settings;
  if (Array.isArray(next.chains)) {
    next.chains = next.chains.map((chain) => {
      if (!isRecord(chain) || !Array.isArray(chain.targets)) return chain;
      return {
        ...chain,
        targets: chain.targets.map((target) => {
          if (!isRecord(target)) return target;
          const migratedTarget = { ...target };
          delete migratedTarget.ttftAction;
          return migratedTarget;
        }),
      };
    });
  }
  next.version = 2;
  return next;
};

export const configMigrations: Record<number, Migration> = { 1: migrateConfigV1 };
export const stateMigrations: Record<number, Migration> = {};
