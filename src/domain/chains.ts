import { providersWithModel } from "./providers.js";
import type {
  Chain,
  ModelNode,
  ModelsJson,
  Settings,
  Target,
  TargetRef,
  TargetSettings,
} from "./types.js";

const clone = <T>(value: T): T => structuredClone(value);

const targetRef = (ref: TargetRef): Target => {
  const slash = ref.indexOf("/");
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
};

const targetKey = (target: Target): string => `${target.provider}/${target.modelId}`;

export function upsertChain(chains: Chain[], chain: Chain): Chain[] {
  const next = clone(chains);
  const index = next.findIndex((entry) => entry.id === chain.id);
  const copy = clone(chain);
  if (index === -1) return [...next, copy];
  next[index] = copy;
  return next;
}

export function removeChain(chains: Chain[], id: string): Chain[] {
  return clone(chains).filter((chain) => chain.id !== id);
}

export function moveTarget(chain: Chain, index: number, delta: -1 | 1): Chain {
  const next = clone(chain);
  const destination = index + delta;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= next.targets.length ||
    destination < 0 ||
    destination >= next.targets.length
  ) {
    return next;
  }

  const current = next.targets[index];
  const other = next.targets[destination];
  if (current === undefined || other === undefined) return next;
  next.targets[index] = other;
  next.targets[destination] = current;
  return next;
}

export function addTargets(chain: Chain, refs: TargetRef[]): Chain {
  const next = clone(chain);
  const seen = new Set(next.targets.map(targetKey));

  for (const ref of refs) {
    const target = targetRef(ref);
    if (target.provider === "failover") {
      throw new Error("failover targets are not allowed in chains");
    }
    if (seen.has(ref)) continue;
    next.targets.push(target);
    seen.add(ref);
  }

  return next;
}

export function removeTarget(chain: Chain, ref: TargetRef): Chain {
  return clone(chain).targets.reduce<Chain>(
    (next, target) => {
      if (targetKey(target) !== ref) next.targets.push(target);
      return next;
    },
    { ...clone(chain), targets: [] },
  );
}

export function chainsReferencing(chains: Chain[], providerId: string): Chain[] {
  return clone(chains).filter((chain) =>
    chain.targets.some((target) => target.provider === providerId),
  );
}

export function dropProvider(chains: Chain[], providerId: string): Chain[] {
  return clone(chains).map((chain) => ({
    ...chain,
    targets: chain.targets.filter((target) => target.provider !== providerId),
  }));
}

export function sameModelImport(chain: Chain, models: ModelsJson, modelId: string): Chain {
  const refs = providersWithModel(models, modelId).map(
    (provider): TargetRef => `${provider}/${modelId}`,
  );
  return addTargets(chain, refs);
}

export function virtualModelNode(chain: Chain, models: ModelsJson): ModelNode | null {
  const firstTarget = chain.targets[0];
  if (!firstTarget) return null;

  const source = models.providers[firstTarget.provider]?.models.find(
    (model) => model.id === firstTarget.modelId,
  );
  if (!source) return null;

  return { ...clone(source), id: chain.id, name: chain.name };
}

export function resolveTargetSettings(target: Target, settings: Settings): TargetSettings {
  return {
    errorHandlingMode: target.errorHandlingMode ?? settings.errorHandlingMode,
    maxRetries: target.maxRetries ?? settings.maxRetries,
    reasoningEffort: target.reasoningEffort ?? settings.reasoningEffort,
    modelParameters: clone(target.modelParameters ?? settings.modelParameters),
    noProgressTimeoutSeconds: target.noProgressTimeoutSeconds ?? settings.noProgressTimeoutSeconds,
    ttftTimeoutSeconds: target.ttftTimeoutSeconds ?? settings.ttftTimeoutSeconds,
    ttftAction: target.ttftAction ?? settings.ttftAction,
  };
}
