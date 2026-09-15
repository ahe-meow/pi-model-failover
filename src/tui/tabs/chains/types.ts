import type { ConfigStore } from "../../../config/configStore.js";
import type { SharedState } from "../../../config/sharedState.js";
import type { Chain, ModelsJson } from "../../../domain/types.js";
import type { HistoryLog } from "../../../history/historyLog.js";

export interface ChainsDeps {
  config: ConfigStore;
  models: () => ModelsJson;
  state: SharedState;
  history: HistoryLog;
  registrar: { syncFailover(chains: Chain[], models: ModelsJson): void };
  useModel?: (providerId: string, modelId: string) => Promise<void>;
  notify: (message: string) => void;
  now: () => string;
  sessionId: string;
  createChainId: () => string;
}

// SAFETY: The fallback keeps pre-P2 no-argument App construction usable; normal composition injects real stores and actions.
export const emptyChainsDeps = (): ChainsDeps =>
  ({
    config: { get: () => ({ chains: [] }) },
    models: () => ({ providers: {} }),
    state: { read: async () => ({}), update: async () => {} },
    history: { append: async () => {} },
    registrar: { syncFailover: () => {} },
    notify: () => {},
    now: () => "1970-01-01T00:00:00.000Z",
    sessionId: "",
    createChainId: () => "chain",
  }) as unknown as ChainsDeps;
