import type { ModelNode, ModelsJson, ProviderNode } from "./types.js";

const clone = (models: ModelsJson): ModelsJson => structuredClone(models);

export function listProviders(
  models: ModelsJson,
): Array<{ id: string; node: ProviderNode; owned: boolean; multiplier: number | null }> {
  return Object.entries(models.providers).map(([id, node]) => ({
    id,
    node: structuredClone(node),
    owned: node.piModelFailover !== undefined,
    multiplier: node.piModelFailover?.costMultiplier ?? null,
  }));
}

export function upsertProvider(models: ModelsJson, id: string, node: ProviderNode): ModelsJson {
  const next = clone(models);
  next.providers[id] = structuredClone(node);
  return next;
}

export function renameProvider(models: ModelsJson, id: string, name: string): ModelsJson {
  const next = clone(models);
  const provider = next.providers[id];
  if (provider) provider.name = name;
  return next;
}

export function deleteProvider(models: ModelsJson, id: string): ModelsJson {
  const next = clone(models);
  delete next.providers[id];
  return next;
}

export function addModelToProviders(
  models: ModelsJson,
  ids: string[],
  node: ModelNode,
): ModelsJson {
  const next = clone(models);
  for (const id of ids) {
    const provider = next.providers[id];
    if (!provider || provider.models.some((candidate) => candidate.id === node.id)) continue;
    provider.models = [...provider.models, structuredClone(node)];
  }
  return next;
}

export function removeModel(models: ModelsJson, providerId: string, modelId: string): ModelsJson {
  const next = clone(models);
  const provider = next.providers[providerId];
  if (provider) provider.models = provider.models.filter((model) => model.id !== modelId);
  return next;
}

export function setMultiplier(models: ModelsJson, id: string, multiplier: number): ModelsJson {
  const next = clone(models);
  const provider = next.providers[id];
  if (!provider) return next;

  const marker = provider.piModelFailover;
  provider.piModelFailover = marker
    ? { ...marker, costMultiplier: multiplier }
    : { group: null, costMultiplier: multiplier };
  return next;
}

export function providersWithModel(models: ModelsJson, modelId: string): string[] {
  const matches = Object.entries(models.providers)
    .filter(([, provider]) => provider.models.some((model) => model.id === modelId))
    .map(([id, provider]) => ({
      id,
      owned: provider.piModelFailover !== undefined,
      multiplier: provider.piModelFailover?.costMultiplier ?? null,
    }));

  return matches
    .sort((left, right) => {
      if (left.owned !== right.owned) return left.owned ? -1 : 1;
      if (left.owned && right.owned && left.multiplier !== right.multiplier) {
        return (left.multiplier ?? 0) - (right.multiplier ?? 0);
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .map(({ id }) => id);
}
