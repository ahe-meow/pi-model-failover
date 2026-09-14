import type { CatalogModel, ModelNode } from "./types.js";

export const CATALOG_DEFAULTS = {
  reasoning: true,
  vision: true,
  contextWindow: 272000,
  maxTokens: 128000,
  defaults: {},
} satisfies Omit<CatalogModel, "id">;

const inputFor = (vision: boolean): ("text" | "image")[] => (vision ? ["text", "image"] : ["text"]);

export function upsertCatalogModel(catalog: CatalogModel[], model: CatalogModel): CatalogModel[] {
  const next = catalog.slice();
  const index = next.findIndex((entry) => entry.id === model.id);
  const copy = structuredClone(model);
  if (index === -1) return [...next, copy];
  next[index] = copy;
  return next;
}

export function removeCatalogModel(catalog: CatalogModel[], id: string): CatalogModel[] {
  return catalog.filter((model) => model.id !== id);
}

export function toModelNode(model: CatalogModel): ModelNode {
  return {
    id: model.id,
    ...(model.name === undefined ? {} : { name: model.name }),
    reasoning: model.reasoning,
    input: inputFor(model.vision),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    defaults: structuredClone(model.defaults),
  };
}

export function syncAttributes(node: ModelNode, model: CatalogModel): ModelNode {
  return {
    ...structuredClone(node),
    reasoning: model.reasoning,
    input: inputFor(model.vision),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

export function isDrifted(node: ModelNode, model: CatalogModel): boolean {
  const expectedInput = inputFor(model.vision);
  return (
    node.reasoning !== model.reasoning ||
    node.input.length !== expectedInput.length ||
    node.input.some((value, index) => value !== expectedInput[index]) ||
    node.contextWindow !== model.contextWindow ||
    node.maxTokens !== model.maxTokens
  );
}
