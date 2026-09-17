import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { ModelsJsonFile } from "../src/adapters/modelsJson.js";
import { nodeFs } from "../src/adapters/nodeFs.js";
import { ConfigStore } from "../src/config/configStore.js";
import { WriteQueue } from "../src/config/writeQueue.js";
import type { Chain, FailoverEvent, ModelNode, ModelsJson } from "../src/domain/types.js";
import factory from "../src/index.js";
import { FakePi } from "./fakes/fakePi.js";

const runtime = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  getAgentDir: () => runtime.agentDir,
  ModelRuntime: { create: vi.fn(async () => ({ getModels: () => [] })) },
}));

const historyEvent = (
  from: string,
  to: string | null,
  reason: FailoverEvent["reason"],
): FailoverEvent => ({
  ts: "2026-09-16T00:00:00.000Z",
  sessionId: "history-session",
  requestSeq: 1,
  from: from as FailoverEvent["from"],
  to: to as FailoverEvent["to"],
  reason,
  elapsedMs: 10,
});

const modelNode: ModelNode = {
  id: "m",
  name: "Model",
  reasoning: false,
  input: ["text"],
  contextWindow: 8_000,
  maxTokens: 1_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function failoverSetup() {
  const chain: Chain = {
    id: "coding",
    name: "Coding",
    targets: [
      { provider: "relay", modelId: "m" },
      { provider: "backup", modelId: "m" },
    ],
  };
  const models: ModelsJson = {
    providers: {
      relay: {
        name: "Relay",
        baseUrl: "https://relay.example/v1",
        api: "openai-completions",
        models: [modelNode],
      },
      backup: {
        name: "Backup",
        baseUrl: "https://backup.example/v1",
        api: "openai-completions",
        models: [modelNode],
      },
    },
  };
  const registry = {
    find: (provider: string, modelId: string): Model<Api> | undefined =>
      modelId === "m"
        ? {
            id: modelId,
            name: modelId,
            api: "openai-completions",
            provider,
            baseUrl: `https://${provider}.example/v1`,
            reasoning: false,
            input: ["text"],
            contextWindow: 8_000,
            maxTokens: 1_000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          }
        : undefined,
    getProvider: () => ({
      streamSimple: () => {
        throw new Error("HTTP 503: unavailable");
      },
    }),
    getApiKeyAndHeaders: async () => ({ ok: true as const }),
  };
  return { chain, models, registry };
}

type RegisteredFailover = {
  models?: unknown[];
  streamSimple?: (model: unknown, context: unknown) => AsyncIterable<unknown>;
};

async function exerciseFailover(pi: FakePi): Promise<void> {
  const provider = pi.providers.get("failover") as RegisteredFailover | undefined;
  const model = provider?.models?.[0];
  const stream =
    model === undefined ? undefined : provider?.streamSimple?.(model, { messages: [] });
  if (stream === undefined) throw new Error("failover provider was not registered");
  for await (const _event of stream) {
    // Drain the real provider stream so engine callbacks complete.
  }
}

async function openFooter(
  events: FailoverEvent[] = [],
  options: { withFailover?: boolean; openCommand?: boolean } = {},
) {
  runtime.agentDir = mkdtempSync(join(tmpdir(), "pmf-footer-"));
  const modelsFile = new ModelsJsonFile(
    nodeFs,
    new WriteQueue(),
    join(runtime.agentDir, "models.json"),
  );
  const setup = options.withFailover ? failoverSetup() : undefined;
  await modelsFile.update(() => setup?.models ?? { providers: {} });
  const dir = join(runtime.agentDir, "pi-model-failover");
  await nodeFs.mkdir(dir, 0o700);
  if (setup !== undefined) {
    const config = await ConfigStore.open(nodeFs, new WriteQueue(), dir);
    await config.update((value) => {
      value.chains = [setup.chain];
    });
  }
  if (events.length > 0) {
    await nodeFs.writeAtomic(
      join(dir, "history.jsonl"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      0o600,
    );
  }

  const pi = new FakePi();
  await factory(pi as never);
  const setStatus = vi.fn();
  const ui = {
    notify: vi.fn(),
    custom: vi.fn(async (makeComponent: (...args: unknown[]) => unknown) => {
      makeComponent({}, {}, {}, () => {});
    }),
    setFooter: vi.fn(),
    setStatus,
  };
  const ctx = {
    mode: "tui" as const,
    ui,
    cwd: "/workspace/project",
    model: { provider: "relay", id: "m", contextWindow: 8_000 },
    modelRegistry: setup?.registry ?? {},
    thinkingLevel: "medium",
    sessionManager: {},
    getContextUsage: () => undefined,
  };
  if (options.openCommand !== false) await pi.commands.get("failover")?.("", ctx);
  return { pi, ui, ctx, setup };
}

function statusCalls(result: Awaited<ReturnType<typeof openFooter>>): Array<[string, string]> {
  return result.ui.setStatus.mock.calls as Array<[string, string]>;
}

function latestStatuses(result: Awaited<ReturnType<typeof openFooter>>) {
  return Object.fromEntries(statusCalls(result).map(([key, text]) => [key, text]));
}

describe("Footer status integration", () => {
  it("registers exactly two native statuses on command entry without replacing Pi's Footer", async () => {
    const result = await openFooter();

    expect(statusCalls(result)).toEqual([
      ["failover-current", "-"],
      ["failover-fallback", "-"],
    ]);
    expect(result.ui.setFooter).not.toHaveBeenCalled();

    await result.pi.commands.get("failover")?.("", result.ctx);

    const refresh = result.pi.handlers.get("session_start")?.[0];
    expect(refresh).toBeDefined();
    await refresh?.({ type: "session_start", reason: "reload" }, result.ctx);

    expect(statusCalls(result)).toHaveLength(6);
    expect(statusCalls(result).slice(4)).toEqual(statusCalls(result).slice(0, 2));
    expect(result.ui.setFooter).not.toHaveBeenCalled();
  });

  it("hydrates the newest real fallback and ignores final or manual history events", async () => {
    const result = await openFooter([
      historyEvent("relay-old/m", "backup/m", "http-503"),
      historyEvent("backup/m", null, "http-429"),
      historyEvent("backup/m", "relay-manual/m", "manual"),
    ]);

    expect(latestStatuses(result)).toEqual({
      "failover-current": "-",
      "failover-fallback": "backup/m <- http-503",
    });
  });

  it("updates both native statuses for each physical attempt and fallback", async () => {
    const result = await openFooter([], { withFailover: true });

    await exerciseFailover(result.pi);

    expect(statusCalls(result)).toEqual([
      ["failover-current", "-"],
      ["failover-fallback", "-"],
      ["failover-current", "relay/m"],
      ["failover-fallback", "-"],
      ["failover-current", "relay/m"],
      ["failover-fallback", "backup/m <- http-503"],
      ["failover-current", "backup/m"],
      ["failover-fallback", "backup/m <- http-503"],
    ]);
  });

  it("resets Current on a new session while retaining Last fallback", async () => {
    const result = await openFooter([historyEvent("relay-old/m", "backup/m", "http-503")], {
      withFailover: true,
    });
    await exerciseFailover(result.pi);

    const refresh = result.pi.handlers.get("session_start")?.[0];
    expect(refresh).toBeDefined();
    await refresh?.({ type: "session_start", reason: "new" }, result.ctx);

    expect(latestStatuses(result)).toEqual({
      "failover-current": "-",
      "failover-fallback": "backup/m <- http-503",
    });
    expect(statusCalls(result).slice(-2)).toEqual([
      ["failover-current", "-"],
      ["failover-fallback", "backup/m <- http-503"],
    ]);
  });

  it("registers no native statuses outside TUI mode", async () => {
    const result = await openFooter([], { openCommand: false });

    await result.pi.commands.get("failover")?.("", {
      ...result.ctx,
      mode: "rpc",
    });
    const refresh = result.pi.handlers.get("session_start")?.[0];
    expect(refresh).toBeDefined();
    await refresh?.({ type: "session_start", reason: "new" }, { ...result.ctx, mode: "rpc" });

    expect(result.ui.setStatus).not.toHaveBeenCalled();
    expect(result.ui.setFooter).not.toHaveBeenCalled();
  });
});
