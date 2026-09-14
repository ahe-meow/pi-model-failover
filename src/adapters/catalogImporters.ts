import type { Fetch } from "../domain/ports.js";
import type { CatalogModel } from "../domain/types.js";

type CatalogImportErrorCode = "http" | "invalid-json" | "invalid-body" | "runtime";

type RuntimeModel = {
  id: string;
  name?: string;
  reasoning?: unknown;
  input?: unknown;
  contextWindow: number;
  maxTokens: number;
  samplingParams?: Record<string, unknown> | null;
};

export class CatalogImportError extends Error {
  constructor(readonly code: CatalogImportErrorCode) {
    super(`Catalog import failed: ${code}`);
    this.name = "CatalogImportError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const endpointUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}${trimmed.endsWith("/v1") ? "" : "/v1"}/models`;
};

const requireEndpointBody = (body: unknown): string[] => {
  if (!isRecord(body) || !Array.isArray(body.data)) throw new CatalogImportError("invalid-body");

  const ids: string[] = [];
  for (const entry of body.data) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new CatalogImportError("invalid-body");
    }
    ids.push(entry.id);
  }
  return ids;
};

export async function fetchEndpointModels(
  fetch: Fetch,
  template: { baseUrl: string; apiKey?: string; headers?: Record<string, string> },
): Promise<string[]> {
  const headers = { ...(template.headers ?? {}) };
  if (template.apiKey !== undefined && template.apiKey !== "")
    headers.Authorization = `Bearer ${template.apiKey}`;

  let response: Response;
  try {
    // pi-lens-ignore: ts-ssrf
    response = await fetch(endpointUrl(template.baseUrl), { method: "GET", headers });
  } catch {
    throw new CatalogImportError("http");
  }

  if (response.status < 200 || response.status >= 300) {
    throw new CatalogImportError("http");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CatalogImportError("invalid-json");
  }

  return requireEndpointBody(body);
}

const requireRuntimeModel = (raw: unknown): RuntimeModel => {
  if (!isRecord(raw)) throw new CatalogImportError("runtime");
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    throw new CatalogImportError("runtime");
  }
  if (raw.name !== undefined && typeof raw.name !== "string") {
    throw new CatalogImportError("runtime");
  }
  if (!Number.isFinite(raw.contextWindow) || typeof raw.contextWindow !== "number") {
    throw new CatalogImportError("runtime");
  }
  if (!Number.isFinite(raw.maxTokens) || typeof raw.maxTokens !== "number") {
    throw new CatalogImportError("runtime");
  }
  if (
    raw.samplingParams !== undefined &&
    raw.samplingParams !== null &&
    !isRecord(raw.samplingParams)
  ) {
    throw new CatalogImportError("runtime");
  }
  return raw as RuntimeModel;
};

const toCatalog = (raw: unknown): CatalogModel => {
  const model = requireRuntimeModel(raw);
  try {
    return {
      id: model.id,
      ...(model.name === undefined ? {} : { name: model.name }),
      reasoning: model.reasoning === true,
      vision: Array.isArray(model.input) && model.input.includes("image"),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      defaults: structuredClone(model.samplingParams ?? {}),
    };
  } catch {
    throw new CatalogImportError("runtime");
  }
};

export async function importPiBuiltinCatalog(
  runtimeFactory: () => Promise<{ getModels(): unknown[] }>,
): Promise<CatalogModel[]> {
  try {
    const runtime = await runtimeFactory();
    const models = runtime.getModels();
    if (!Array.isArray(models)) throw new CatalogImportError("runtime");
    return models.map(toCatalog);
  } catch {
    throw new CatalogImportError("runtime");
  }
}
