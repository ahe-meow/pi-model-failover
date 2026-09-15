import type { ConfigStore } from "../../../config/configStore.js";
import type { Fetch } from "../../../domain/ports.js";
import type { ModelsJson } from "../../../domain/types.js";

export const PROVIDER_MODES = ["full", "rename", "multiplier"] as const;

export interface ModelManagerDeps {
  config: ConfigStore;
  modelsFile: {
    read(): Promise<ModelsJson>;
    update(fn: (models: ModelsJson) => ModelsJson): Promise<ModelsJson>;
  };
  initialModels: ModelsJson;
  registrar: { syncOwned(models: ModelsJson): void };
  notify: (message: string) => void;
  now: () => string;
  createKeyGroupId: () => string;
  fetch?: Fetch;
  runtimeFactory?: () => Promise<{ getModels(): unknown[] }>;
  afterProviderDelete?: (providerId: string, models: ModelsJson) => Promise<void>;
  afterProviderRename?: (
    previousId: string,
    providerId: string,
    models: ModelsJson,
  ) => Promise<void>;
}

export type Screen = "list" | "detail" | "form" | "catalog";
