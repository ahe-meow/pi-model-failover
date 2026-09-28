import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Registrar } from "../../src/adapters/registrar.js";
import type { Chain, ModelNode, ModelsJson } from "../../src/domain/types.js";

const model: ModelNode = {
  id: "coding",
  name: "Coding",
  api: "pi-model-failover",
  reasoning: false,
  input: ["text"],
  contextWindow: 4096,
  maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const chain: Chain = {
  id: "coding",
  name: "Coding",
  targets: [{ provider: "relay", modelId: "m" }],
};

class PiSpy {
  readonly registrations: Array<{ id: string; config: unknown }> = [];
  readonly removals: string[] = [];
  registerProvider(id: string, config: unknown): void {
    this.registrations.push({ id, config });
  }
  unregisterProvider(id: string): void {
    this.removals.push(id);
  }
  isBuiltin(): boolean {
    return false;
  }
}

describe("Registrar failover catalog persistence", () => {
  it("persists the same virtual model catalog before registering the runtime handler", async () => {
    const pi = new PiSpy();
    const persisted: ModelNode[][] = [];
    const registrar = new Registrar(
      pi,
      vi.fn(),
      () =>
        ({
          api: "pi-model-failover",
          apiKey: "unused",
          baseUrl: "https://failover.invalid",
          models: [model],
        }) as ProviderConfig,
      async (models) => {
        persisted.push(models);
      },
    );

    await registrar.syncFailover([chain], { providers: {} });

    expect(persisted).toEqual([[model]]);
    expect(pi.registrations[0]).toMatchObject({ id: "failover", config: { models: [model] } });
  });

  it("removes an owned persisted catalog and leaves no runtime Provider when the last Chain is removed", async () => {
    const pi = new PiSpy();
    const persisted: ModelNode[][] = [];
    const registrar = new Registrar(
      pi,
      vi.fn(),
      () => ({ models: [] }) as ProviderConfig,
      async (models) => {
        persisted.push(models);
      },
    );
    const existing: ModelsJson = {
      providers: {
        failover: {
          name: "Failover",
          api: "pi-model-failover",
          models: [model],
          piModelFailoverVirtual: true,
        },
      },
    };

    await registrar.syncFailover([], existing);

    expect(persisted).toEqual([[]]);
    expect(pi.registrations).toEqual([]);
    expect(pi.removals).toEqual(["failover"]);
  });
});
