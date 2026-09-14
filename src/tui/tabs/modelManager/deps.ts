import type { ConfigStore } from "../../../config/configStore.js";
import type { ModelManagerDeps } from "../modelManager.js";

// SAFETY: The fallback keeps pre-P2 no-argument construction usable; production composition injects real stores and actions.
export const emptyModelManagerDeps = (): ModelManagerDeps => ({
  config: { get: () => ({ catalog: [] }) } as unknown as ConfigStore,
  modelsFile: {
    read: async () => ({ providers: {} }),
    update: async (fn) => fn({ providers: {} }),
  },
  initialModels: { providers: {} },
  registrar: { syncOwned: () => {} },
  notify: () => {},
  now: () => String(),
  createKeyGroupId: () => String(),
});
