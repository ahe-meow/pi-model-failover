export const CONFIG_VERSION = 1;
export const STATE_VERSION = 1;

type Migration = (raw: unknown) => unknown;

const emptyConfigMigrations = {} satisfies Record<number, Migration>;
const emptyStateMigrations = {} satisfies Record<number, Migration>;

export const configMigrations = emptyConfigMigrations as Record<number, Migration>;
export const stateMigrations = emptyStateMigrations as Record<number, Migration>;
