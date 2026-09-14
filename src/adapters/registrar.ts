import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { Chain, ModelsJson } from "../domain/types.js";
import { S } from "../strings.js";

export interface PiRegistrar {
  registerProvider(id: string, config: unknown): void;
  unregisterProvider(id: string): void;
  isBuiltin(id: string): boolean;
}

export type FailoverConfigFactory = (chains: Chain[], models: ModelsJson) => ProviderConfig;

export class Registrar {
  private readonly registered = new Set<string>();
  private failoverRegistered = false;

  constructor(
    private readonly pi: PiRegistrar,
    private readonly notify: (message: string) => void,
    private readonly createFailoverConfig: FailoverConfigFactory,
  ) {}

  syncOwned(models: ModelsJson): void {
    const owned = new Set(
      Object.entries(models.providers)
        .filter(([, provider]) => provider.piModelFailover !== undefined)
        .map(([id]) => id),
    );

    for (const id of this.registered) {
      if (!owned.has(id)) {
        this.pi.unregisterProvider(id);
        this.registered.delete(id);
      }
    }

    for (const [id, provider] of Object.entries(models.providers)) {
      if (!provider.piModelFailover || id === "failover") continue;
      if (this.pi.isBuiltin(id)) {
        this.notify(S.registrar.builtinSkipped(id));
        continue;
      }
      try {
        this.pi.registerProvider(id, provider);
        this.registered.add(id);
      } catch {
        this.notify(S.registrar.registrationFailed(id));
      }
    }
  }

  syncFailover(chains: Chain[], models: ModelsJson): void {
    if (this.pi.isBuiltin("failover")) {
      this.notify(S.registrar.builtinSkipped("failover"));
      return;
    }

    let config: ProviderConfig;
    try {
      config = this.createFailoverConfig(chains, models);
    } catch {
      this.notify(S.registrar.registrationFailed("failover"));
      return;
    }

    if ((config.models?.length ?? 0) === 0) {
      if (this.failoverRegistered) {
        this.pi.unregisterProvider("failover");
        this.failoverRegistered = false;
      }
      return;
    }

    try {
      this.pi.registerProvider("failover", config);
      this.failoverRegistered = true;
    } catch {
      this.notify(S.registrar.registrationFailed("failover"));
    }
  }
}
