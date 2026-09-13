import type { WriteQueue } from "../config/writeQueue.js";
import type { FileSystem } from "../domain/ports.js";
import type { ApiType, ModelNode, ModelsJson, ProviderNode } from "../domain/types.js";
import { S } from "../strings.js";

const API_TYPES: readonly ApiType[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isApiType(value: unknown): value is ApiType {
  return typeof value === "string" && API_TYPES.includes(value as ApiType);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function hasOptional(
  value: Record<string, unknown>,
  key: string,
  predicate: (entry: unknown) => boolean,
): boolean {
  return !Object.hasOwn(value, key) || predicate(value[key]);
}

function isCost(value: unknown): value is ModelNode["cost"] {
  return (
    isRecord(value) &&
    isFiniteNumber(value.input) &&
    isFiniteNumber(value.output) &&
    isFiniteNumber(value.cacheRead) &&
    isFiniteNumber(value.cacheWrite)
  );
}

function isThinkingLevelMap(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => entry === null || typeof entry === "string")
  );
}

function isInputList(value: unknown): value is ("text" | "image")[] {
  return Array.isArray(value) && value.every((entry) => entry === "text" || entry === "image");
}

function isModelNode(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    hasOptional(value, "name", (entry) => typeof entry === "string") &&
    hasOptional(value, "api", isApiType) &&
    hasOptional(value, "baseUrl", (entry) => typeof entry === "string") &&
    hasOptional(value, "reasoning", (entry) => typeof entry === "boolean") &&
    hasOptional(value, "input", isInputList) &&
    hasOptional(value, "thinkingLevelMap", isThinkingLevelMap) &&
    hasOptional(value, "contextWindow", isFiniteNumber) &&
    hasOptional(value, "maxTokens", isFiniteNumber) &&
    hasOptional(value, "cost", isCost) &&
    hasOptional(value, "headers", isStringRecord) &&
    hasOptional(value, "compat", isRecord)
  );
}

function isOwnershipMarker(value: unknown): value is NonNullable<ProviderNode["piModelFailover"]> {
  return (
    isRecord(value) &&
    (typeof value.group === "string" || value.group === null) &&
    isFiniteNumber(value.costMultiplier)
  );
}

function isManagerMarker(value: unknown): value is NonNullable<ProviderNode["piModelManager"]> {
  return isRecord(value) && typeof value.managed === "boolean";
}

function isProviderNode(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasOptional(value, "name", (entry) => typeof entry === "string") &&
    hasOptional(value, "baseUrl", (entry) => typeof entry === "string") &&
    hasOptional(value, "api", isApiType) &&
    hasOptional(value, "apiKey", (entry) => typeof entry === "string") &&
    hasOptional(value, "authHeader", (entry) => typeof entry === "boolean") &&
    hasOptional(value, "headers", isStringRecord) &&
    hasOptional(value, "compat", isRecord) &&
    hasOptional(value, "modelOverrides", isRecord) &&
    hasOptional(value, "models", (entry) => Array.isArray(entry) && entry.every(isModelNode)) &&
    hasOptional(value, "piModelFailover", isOwnershipMarker) &&
    hasOptional(value, "piModelManager", isManagerMarker)
  );
}

function isCompleteModelNode(value: unknown): value is ModelNode {
  return (
    isModelNode(value) &&
    typeof value.reasoning === "boolean" &&
    isInputList(value.input) &&
    isFiniteNumber(value.contextWindow) &&
    isFiniteNumber(value.maxTokens) &&
    isCost(value.cost)
  );
}

function isCompleteProviderNode(value: unknown): value is ProviderNode {
  return (
    isProviderNode(value) &&
    typeof value.name === "string" &&
    typeof value.baseUrl === "string" &&
    isApiType(value.api) &&
    Array.isArray(value.models) &&
    value.models.every(isCompleteModelNode)
  );
}

function zeroCost(): NonNullable<ModelNode["cost"]> {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function normalizeModel(value: ModelNode): ModelNode {
  const { name, api, baseUrl, thinkingLevelMap, headers, compat, ...rest } = value;
  return {
    ...rest,
    ...(typeof name === "string" ? { name } : {}),
    ...(isApiType(api) ? { api } : {}),
    ...(typeof baseUrl === "string" ? { baseUrl } : {}),
    reasoning: value.reasoning === true,
    ...(isThinkingLevelMap(thinkingLevelMap) ? { thinkingLevelMap } : {}),
    input: isInputList(value.input) ? [...value.input] : ["text"],
    contextWindow: isFiniteNumber(value.contextWindow) ? value.contextWindow : 128000,
    maxTokens: isFiniteNumber(value.maxTokens) ? value.maxTokens : 16384,
    cost: isCost(value.cost) ? structuredClone(value.cost) : zeroCost(),
    ...(isStringRecord(headers) ? { headers } : {}),
    ...(isRecord(compat) ? { compat } : {}),
  };
}

function normalizeProvider(id: string, value: ProviderNode): ProviderNode {
  const { baseUrl, api, apiKey, authHeader, headers, compat, modelOverrides, ...rest } = value;
  return {
    ...rest,
    name: typeof value.name === "string" ? value.name : id,
    ...(typeof baseUrl === "string" ? { baseUrl } : {}),
    ...(isApiType(api) ? { api } : {}),
    ...(typeof apiKey === "string" ? { apiKey } : {}),
    ...(typeof authHeader === "boolean" ? { authHeader } : {}),
    ...(isStringRecord(headers) ? { headers } : {}),
    ...(isRecord(compat) ? { compat } : {}),
    ...(isRecord(modelOverrides) ? { modelOverrides } : {}),
    models: Array.isArray(value.models) ? value.models.map(normalizeModel) : [],
  };
}

function validateModelsJson(value: unknown): asserts value is ModelsJson {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, "providers") ||
    !isRecord(value.providers) ||
    !Object.values(value.providers).every(isProviderNode)
  ) {
    throw new Error(S.modelsJsonInvalid);
  }
}

function validateStrictModelsJson(value: unknown): asserts value is ModelsJson {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, "providers") ||
    !isRecord(value.providers) ||
    !Object.values(value.providers).every(isCompleteProviderNode)
  ) {
    throw new Error(S.modelsJsonInvalid);
  }
}

function normalizeModelsJson(value: unknown): ModelsJson {
  validateModelsJson(value);
  return {
    ...value,
    providers: Object.fromEntries(
      Object.entries(value.providers).map(([id, provider]) => [
        id,
        normalizeProvider(id, provider),
      ]),
    ),
  };
}

export class ModelsJsonFile {
  constructor(
    private readonly fs: FileSystem,
    private readonly queue: WriteQueue,
    private readonly path: string,
  ) {}

  async read(): Promise<ModelsJson> {
    const text = await this.fs.readText(this.path);
    if (text === null) return { providers: {} };

    try {
      const value: unknown = JSON.parse(text);
      return normalizeModelsJson(value);
    } catch {
      throw new Error(S.modelsJsonInvalid);
    }
  }

  update(fn: (models: ModelsJson) => ModelsJson): Promise<ModelsJson> {
    return this.queue.enqueue(async () => {
      const current = await this.read();
      const candidate = fn(structuredClone(current));
      validateStrictModelsJson(candidate);
      const serialized = `${JSON.stringify(candidate, null, 2)}\n`;
      await this.fs.writeAtomic(this.path, serialized, 0o600);
      return structuredClone(candidate);
    });
  }
}
