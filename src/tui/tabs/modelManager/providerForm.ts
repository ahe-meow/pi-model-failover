import {
  renameProvider,
  renameProviderId,
  setMultiplier,
  upsertProvider,
} from "../../../domain/providers.js";
import type { ApiType, ModelsJson, ProviderNode } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import type { Field } from "../../primitives/form.js";
import type { ModelManagerDeps } from "../modelManager.js";
import {
  type Fail,
  FormView,
  persist,
  selectField,
  text,
  textField,
  type Values,
} from "./formView.js";

const P = S.modelManager.providerForm;
const E = String();
const PROVIDER_ID_COLLISION = Symbol();
export type ProviderMode = "full" | "rename" | "multiplier";
export interface ProviderFormOptions extends ModelManagerDeps {
  providerId?: string;
  onProviderIdChange?: (providerId: string) => void;
  onDone: (models: ModelsJson) => void;
  onCancel: () => void;
  mode?: ProviderMode;
}
const API_OPTIONS = [...S.modelManager.keyGroupForm.apiOptions];
const serializeHeaders = (headers?: Record<string, string>): string =>
  Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
const providerTitle = (mode: ProviderMode, add: boolean): string =>
  ({ rename: P.renameTitle, multiplier: P.multiplierTitle, full: add ? P.addTitle : P.editTitle })[
    mode
  ];
const validProviderName = (name: string): boolean => Boolean(name) && !/[\s/]/.test(name);
const validHttpUrl = (url: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};
const positive = (value: unknown): number | undefined => {
  const result = Number(typeof value === "string" ? value.trim() : value);
  return Number.isFinite(result) && result > 0 ? result : undefined;
};
function providerFields(
  provider: ProviderNode | undefined,
  mode: ProviderMode,
  providerId: string | undefined,
): Field[] {
  const labels = P.labels;
  const nameField = (value: string): Field => textField("name", labels.name, value);
  const idField = (value: string): Field => textField("id", labels.id, value);
  const mField = (value: string): Field => textField("multiplier", labels.multiplier, value);
  const multiplier = provider?.piModelFailover?.costMultiplier,
    authHeader = provider?.authHeader ? String(true) : E;
  if (mode === "rename") return [nameField(provider?.name ?? E)];
  if (mode === "multiplier") return [mField(String(multiplier ?? 1))];
  return [
    ...(providerId === undefined ? [] : [idField(providerId)]),
    nameField(provider?.name ?? E),
    textField("baseUrl", labels.baseUrl, provider?.baseUrl ?? E),
    selectField("api", labels.api, provider?.api ?? API_OPTIONS[0] ?? E, API_OPTIONS),
    textField("apiKey", labels.apiKey, provider?.apiKey ?? E, { secret: true }),
    textField("authHeader", labels.authHeader, authHeader, { secret: true }),
    textField("headers", labels.headers, serializeHeaders(provider?.headers), {
      secret: true,
      multiline: true,
    }),
    textField("multiplier", labels.multiplier, multiplier === undefined ? E : String(multiplier)),
  ];
}
function parseHeaders(value: string): Record<string, string> | string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.some((line) => line.indexOf(":") < 1)) return P.invalidHeaders;
  const headerParts = (line: string): [string, string] => {
    const index = line.indexOf(":");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  };
  return Object.fromEntries(lines.map(headerParts));
}
function parseProvider(values: Values, required: boolean) {
  const name = text(values, "name").trim();
  if (!validProviderName(name)) return P.invalidName;
  const baseUrl = text(values, "baseUrl").trim();
  if (!validHttpUrl(baseUrl)) return P.invalidUrl;
  const api = text(values, "api") as ApiType;
  if (!API_OPTIONS.includes(api)) return P.invalidApi;
  const headers = parseHeaders(text(values, "headers"));
  if (typeof headers === "string") return headers;
  const rawMultiplier = text(values, "multiplier").trim();
  const multiplier = rawMultiplier ? positive(rawMultiplier) : undefined;
  if ((!required || rawMultiplier) && (!rawMultiplier || multiplier !== undefined)) {
    return {
      name,
      baseUrl,
      api,
      apiKey: text(values, "apiKey"),
      authHeader: text(values, "authHeader").trim().toLowerCase() === String(true),
      headers,
      ...(multiplier === undefined ? {} : { multiplier }),
    };
  }
  return P.invalidMultiplier;
}
function buildProviderNode(
  values: Exclude<ReturnType<typeof parseProvider>, string>,
  existing?: ProviderNode,
): ProviderNode {
  const node: ProviderNode = existing
    ? structuredClone(existing)
    : { name: values.name, baseUrl: values.baseUrl, api: values.api, models: [] };
  Object.assign(node, { name: values.name, baseUrl: values.baseUrl, api: values.api });
  if (values.apiKey) node.apiKey = values.apiKey;
  else Reflect.deleteProperty(node, "apiKey");
  if (values.authHeader) node.authHeader = true;
  else Reflect.deleteProperty(node, "authHeader");
  if (Object.keys(values.headers).length === 0) Reflect.deleteProperty(node, "headers");
  else node.headers = structuredClone(values.headers);
  return node;
}
export class ProviderForm extends FormView {
  constructor(private readonly options: ProviderFormOptions) {
    const mode = options.mode ?? "full";
    const { providerId } = options;
    const provider =
      providerId === undefined ? undefined : options.initialModels.providers[providerId];
    super(
      providerFields(provider, mode, providerId),
      providerTitle(mode, providerId === undefined),
      options.notify,
      P.saveFailed,
      (values, fail) => this.submit(values, mode, fail),
      options.onCancel,
      { exitOnEscape: mode === "multiplier" },
    );
  }
  private async submit(values: Values, mode: ProviderMode, fail: Fail): Promise<void> {
    const save = (update: (models: ModelsJson) => ModelsJson) =>
      persist(this.options, update, this.options.onDone);
    if (mode === "rename") {
      const name = text(values, "name").trim();
      if (this.options.providerId === undefined || !validProviderName(name))
        return fail(P.invalidName);
      return save((models) => renameProvider(models, this.options.providerId as string, name));
    }
    if (mode === "multiplier") {
      const multiplier = positive(text(values, "multiplier"));
      if (this.options.providerId === undefined || multiplier === undefined)
        return fail(P.invalidMultiplier);
      return save((models) => setMultiplier(models, this.options.providerId as string, multiplier));
    }
    const parsed = parseProvider(values, this.options.providerId === undefined);
    if (typeof parsed === "string") return fail(parsed);
    const previousId = this.options.providerId;
    const id = previousId === undefined ? parsed.name : text(values, "id").trim();
    if (previousId !== undefined && !validProviderName(id)) return fail(P.invalidId);
    if (previousId !== undefined && id !== previousId) {
      const current = await this.options.modelsFile.read();
      if (current.providers[id] !== undefined) return fail(P.duplicateId);
    }
    const moved = previousId !== undefined && previousId !== id;
    let next: ModelsJson;
    try {
      next = await this.options.modelsFile.update(
        (models) => {
          if (models.providers[id] !== undefined && id !== previousId) throw PROVIDER_ID_COLLISION;
          const base = previousId === undefined ? models : renameProviderId(models, previousId, id);
          const updated = upsertProvider(base, id, buildProviderNode(parsed, base.providers[id]));
          return parsed.multiplier === undefined
            ? updated
            : setMultiplier(updated, id, parsed.multiplier);
        },
        { deferFailoverSync: moved },
      );
    } catch (error) {
      if (error === PROVIDER_ID_COLLISION) return fail(P.duplicateId);
      throw error;
    }
    if (moved && previousId !== undefined) {
      this.options.onProviderIdChange?.(id);
      await this.options.afterProviderRename?.(previousId, id, next);
    }
    if (!moved || this.options.afterProviderRename === undefined)
      this.options.registrar.syncOwned(next);
    this.options.onDone(next);
  }
}
