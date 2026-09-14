import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  type FailoverConfigFactory,
  type PiRegistrar,
  Registrar,
} from "../../src/adapters/registrar.js";
import type { Chain, ModelsJson, ProviderNode } from "../../src/domain/types.js";
import { S } from "../../src/strings.js";

class FakePiRegistrar implements PiRegistrar {
  readonly registered: string[] = [];
  readonly attempted: Array<{ id: string; config: unknown }> = [];
  readonly unregistered: string[] = [];
  readonly configs = new Map<string, unknown>();
  readonly builtins: Set<string>;
  readonly failures: Set<string>;

  constructor(options: { builtin?: string; fail?: string } = {}) {
    this.builtins = new Set(options.builtin === undefined ? [] : [options.builtin]);
    this.failures = new Set(options.fail === undefined ? [] : [options.fail]);
  }

  registerProvider(id: string, config: unknown): void {
    this.attempted.push({ id, config });
    if (this.failures.has(id)) throw new Error(`invalid provider ${JSON.stringify(config)}`);
    this.registered.push(id);
    this.configs.set(id, config);
  }

  unregisterProvider(id: string): void {
    this.unregistered.push(id);
    this.configs.delete(id);
  }

  isBuiltin(id: string): boolean {
    return this.builtins.has(id);
  }
}

const ownedProvider = (id: string, apiKey = `fixture-key-${id}`): ProviderNode => ({
  name: id,
  baseUrl: `https://${id}.example/v1`,
  api: "openai-completions",
  apiKey,
  models: [],
  piModelFailover: { group: "kg-1", costMultiplier: 0.1 },
});

const unownedProvider = (id: string): ProviderNode => ({
  name: id,
  baseUrl: `https://${id}.example/v1`,
  api: "openai-completions",
  models: [],
});

const failoverConfig: FailoverConfigFactory = (
  chains: Chain[],
  _models: ModelsJson,
): ProviderConfig => ({
  models: chains.map(({ id, name }) => ({
    id,
    name,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
  })),
});

const chainWithModel = (id = "coding", name = "Coding"): Chain => ({
  id,
  name,
  targets: [{ provider: "relay", modelId: "m" }],
});

const emptyFailoverFactory: FailoverConfigFactory = () => ({ models: [] });

describe("Registrar", () => {
  it("registers owned providers, skips built-ins, and unregisters removed ids", () => {
    const pi = new FakePiRegistrar({ builtin: "pmm" });
    const notify = vi.fn();
    const registrar = new Registrar(pi, notify, emptyFailoverFactory);
    const models: ModelsJson = {
      providers: {
        relay: ownedProvider("relay"),
        pmm: ownedProvider("pmm"),
        foreign: unownedProvider("foreign"),
        failover: ownedProvider("failover"),
      },
    };

    registrar.syncOwned(models);

    expect(pi.registered).toEqual(["relay"]);
    expect(pi.configs.get("relay")).toBe(models.providers.relay);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(S.registrar.builtinSkipped("pmm"));
    expect(pi.attempted.some(({ id }) => id === "failover")).toBe(false);

    registrar.syncOwned({ providers: {} });

    expect(pi.unregistered).toEqual(["relay"]);
  });

  it("reports registration failures without exposing the raw provider configuration", () => {
    const apiKey = "fixture-registration-secret";
    const provider = ownedProvider("relay", apiKey);
    const pi = new FakePiRegistrar({ fail: "relay" });
    const notify = vi.fn();
    const registrar = new Registrar(pi, notify, emptyFailoverFactory);

    registrar.syncOwned({ providers: { relay: provider } });

    expect(pi.attempted).toEqual([{ id: "relay", config: provider }]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(S.registrar.registrationFailed("relay"));
    expect(JSON.stringify(notify.mock.calls)).not.toContain(apiKey);
    expect(JSON.stringify(notify.mock.calls)).not.toContain("invalid provider");
    expect(pi.registered).toEqual([]);
    expect(pi.unregistered).toEqual([]);
  });

  it("registers, replaces, and unregisters failover Virtual Models", () => {
    const pi = new FakePiRegistrar();
    const notify = vi.fn();
    const factory = vi.fn(failoverConfig);
    const registrar = new Registrar(pi, notify, factory);
    const models: ModelsJson = { providers: {} };

    registrar.syncFailover([chainWithModel()], models);
    expect(pi.attempted.at(-1)).toMatchObject({
      id: "failover",
      config: { models: [{ id: "coding", name: "Coding" }] },
    });
    expect(factory).toHaveBeenLastCalledWith([chainWithModel()], models);

    registrar.syncFailover([chainWithModel("renamed", "Renamed")], models);
    expect(pi.attempted.at(-1)).toMatchObject({
      id: "failover",
      config: { models: [{ id: "renamed", name: "Renamed" }] },
    });

    registrar.syncFailover([], models);
    expect(pi.unregistered).toContain("failover");
    expect(notify).not.toHaveBeenCalled();
  });

  it("skips a built-in failover id and notifies once", () => {
    const notify = vi.fn();
    const pi = new FakePiRegistrar({ builtin: "failover" });
    const registrar = new Registrar(pi, notify, emptyFailoverFactory);

    registrar.syncFailover([chainWithModel()], { providers: {} });

    expect(pi.attempted).toEqual([]);
    expect(pi.registered).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(S.registrar.builtinSkipped("failover"));
  });

  it("keeps the failover registration state separate from owned providers", () => {
    const pi = new FakePiRegistrar();
    const registrar = new Registrar(pi, vi.fn(), emptyFailoverFactory);

    registrar.syncFailover([chainWithModel()], { providers: {} });
    registrar.syncOwned({ providers: {} });

    expect(pi.unregistered).not.toContain("failover");
  });
});
