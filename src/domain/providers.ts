import {
  FAILOVER_PROVIDER_API,
  type ModelNode,
  type ModelsJson,
  type ProviderNode,
} from "./types.js";

const clone = (models: ModelsJson): ModelsJson => structuredClone(models);

export function listProviders(
  models: ModelsJson,
): Array<{ id: string; node: ProviderNode; owned: boolean; multiplier: number | null }> {
  return Object.entries(models.providers)
    .filter(([id]) => id !== "failover")
    .map(([id, node]) => ({
      id,
      node: structuredClone(node),
      owned: node.piModelFailover !== undefined,
      multiplier: node.piModelFailover?.costMultiplier ?? null,
    }));
}

export function syncFailoverVirtualModels(
  models: ModelsJson,
  virtualModels: ModelNode[],
): ModelsJson {
  const next = clone(models);
  const current = next.providers.failover;

  if (virtualModels.length === 0) {
    if (current?.piModelFailoverVirtual) delete next.providers.failover;
    return next;
  }
  if (current !== undefined && current.piModelFailoverVirtual !== true) {
    throw new Error("The failover provider id is reserved");
  }

  next.providers.failover = {
    ...(current ?? {}),
    name: "Failover",
    api: FAILOVER_PROVIDER_API,
    models: virtualModels.map((model) => {
      const { apiKey: _apiKey, headers: _headers, ...safeModel } = structuredClone(model);
      return safeModel;
    }),
    piModelFailoverVirtual: true,
  };
  delete next.providers.failover.apiKey;
  delete next.providers.failover.baseUrl;
  delete next.providers.failover.headers;
  delete next.providers.failover.authHeader;
  return next;
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

export function renameProviderId(models: ModelsJson, oldId: string, newId: string): ModelsJson {
  const next = clone(models);
  if (oldId === newId || next.providers[oldId] === undefined || next.providers[newId] !== undefined)
    return next;
  next.providers = Object.fromEntries(
    Object.entries(next.providers).map(([id, node]) => [id === oldId ? newId : id, node]),
  );
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
    .filter(
      ([id, provider]) =>
        id !== "failover" && provider.models.some((model) => model.id === modelId),
    )
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
