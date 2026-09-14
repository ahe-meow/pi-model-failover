import type { FileSystem } from "../domain/ports.js";
import type { CatalogModel, Chain, KeyGroup, Settings } from "../domain/types.js";
import { JsonStore } from "./jsonStore.js";
import { CONFIG_VERSION, configMigrations } from "./migrations.js";
import type { WriteQueue } from "./writeQueue.js";

export interface ConfigFile {
  version: 1;
  settings: Settings;
  catalog: CatalogModel[];
  keyGroups: KeyGroup[];
  chains: Chain[];
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: Settings = {
  listRows: 7,
  ttftTimeoutSeconds: 60,
  ttftAction: "cooldown-only",
  maxRetries: 5,
  errorHandlingMode: "smart",
  noProgressTimeoutSeconds: 90,
  reasoningEffort: "inherit",
  modelParameters: {},
};

export const LIST_ROWS_MIN = 5;
export const LIST_ROWS_MAX = 20;

const defaults = (): ConfigFile => ({
  version: 1,
  settings: { ...DEFAULT_SETTINGS },
  catalog: [],
  keyGroups: [],
  chains: [],
});

function validate(config: ConfigFile): void {
  const rows = config.settings.listRows;
  if (!Number.isInteger(rows) || rows < LIST_ROWS_MIN || rows > LIST_ROWS_MAX) {
    throw new Error(`listRows must be ${LIST_ROWS_MIN}–${LIST_ROWS_MAX}`);
  }
}

export class ConfigStore {
  private readonly listeners = new Set<() => void>();

  private constructor(
    private readonly store: JsonStore<ConfigFile>,
    private value: ConfigFile,
    readonly loadStatus: string,
  ) {}

  static async open(fs: FileSystem, queue: WriteQueue, dir: string): Promise<ConfigStore> {
    const store = new JsonStore<ConfigFile>(fs, queue, {
      path: `${dir}/config.json`,
      version: CONFIG_VERSION,
      defaults,
      migrations: configMigrations,
    });
    const { value, status } = await store.load();
    return new ConfigStore(
      store,
      {
        ...defaults(),
        ...value,
        settings: { ...DEFAULT_SETTINGS, ...value.settings },
      },
      status,
    );
  }

  get(): ConfigFile {
    return this.value;
  }

  async update(fn: (config: ConfigFile) => void): Promise<void> {
    const next: ConfigFile = structuredClone(this.value);
    fn(next);
    validate(next);
    await this.store.save(next);
    this.value = next;
    for (const listener of this.listeners) listener();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
