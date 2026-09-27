import {
  type CatalogModel,
  type ModelNode,
  normalizeThinkingLevelMap,
  REASONING_LEVELS,
  type ReasoningLevel,
} from "./types.js";

export const CATALOG_DEFAULTS = {
  reasoning: true,
  vision: true,
  contextWindow: 272000,
  maxTokens: 128000,
  defaults: {},
} satisfies Omit<CatalogModel, "id">;

const inputFor = (vision: boolean): ("text" | "image")[] => (vision ? ["text", "image"] : ["text"]);

const supportsLevel = (map: Record<string, string | null>, level: ReasoningLevel): boolean =>
  map[level] !== null && ((level !== "xhigh" && level !== "max") || map[level] !== undefined);

export function supportedReasoningLevels(model: CatalogModel): ReasoningLevel[] {
  if (!model.reasoning) return ["off"];
  const map = normalizeThinkingLevelMap(true, model.thinkingLevelMap) ?? {};
  return REASONING_LEVELS.filter((level) => supportsLevel(map, level));
}

export function setCatalogReasoningLevels(
  catalog: CatalogModel[],
  modelIds: string[],
  levels: readonly ReasoningLevel[],
): CatalogModel[] {
  const selected = new Set(modelIds);
  const enabled = new Set(levels);
  const thinkingLevelMap = Object.fromEntries(
    REASONING_LEVELS.map((level) => [level, enabled.has(level) ? level : null]),
  );
  return catalog.map((model) => {
    const next = structuredClone(model);
    if (!selected.has(model.id)) return next;
    next.reasoning =
      enabled.has("low") ||
      enabled.has("medium") ||
      enabled.has("high") ||
      enabled.has("xhigh") ||
      enabled.has("max");
    next.thinkingLevelMap = thinkingLevelMap;
    return next;
  });
}

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
    ...(model.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: structuredClone(model.thinkingLevelMap) }),
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
    ...(model.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: structuredClone(model.thinkingLevelMap) }),
    input: inputFor(model.vision),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

const sameThinkingLevelMap = (
  left: Record<string, string | null> | undefined,
  right: Record<string, string | null> | undefined,
): boolean => {
  if (left === undefined) return true;
  if (right === undefined) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
};

export function isDrifted(node: ModelNode, model: CatalogModel): boolean {
  const expectedInput = inputFor(model.vision);
  return (
    node.reasoning !== model.reasoning ||
    node.input.length !== expectedInput.length ||
    node.input.some((value, index) => value !== expectedInput[index]) ||
    node.contextWindow !== model.contextWindow ||
    node.maxTokens !== model.maxTokens ||
    !sameThinkingLevelMap(model.thinkingLevelMap, node.thinkingLevelMap)
  );
}
