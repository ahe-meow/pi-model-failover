import { type KeyId, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../../../config/configStore.js";
import { CATALOG_DEFAULTS, syncAttributes } from "../../../domain/catalog.js";
import { renameProvider, setMultiplier, upsertProvider } from "../../../domain/providers.js";
import { redactSecret } from "../../../domain/redact.js";
import type {
  ApiType,
  CatalogModel,
  ModelNode,
  ModelsJson,
  ProviderNode,
} from "../../../domain/types.js";
import { S } from "../../../strings.js";
import type { Confirm } from "../../primitives/confirm.js";
import { type Field, Form } from "../../primitives/form.js";
import type { Row } from "../../primitives/scrollList.js";
import { theme } from "../../primitives/theme.js";
import type { TabComponent } from "../history.js";
import type { ModelManagerDeps } from "../modelManager.js";

const M = S.modelManager;
const { providerForm: P, modelForm: F, catalog: C } = M,
  E = String();
export const CATALOG_HEADERS = {
  catalog: (count: number) => C.header(count),
  "endpoint-provider": () => C.endpointProviderHeader,
  "endpoint-models": () => C.endpointModelsHeader,
  "builtin-models": () => C.builtinHeader,
  "provider-targets": () => C.providerTargetsHeader,
} satisfies Record<string, (count: number) => string>;
export type CatalogMode = keyof typeof CATALOG_HEADERS;
export type ImportedCatalogMode = Extract<CatalogMode, "endpoint-models" | "builtin-models">;
export type CatalogProviderChoice = { id: string; node: ProviderNode };
export const CATALOG_MODES = Object.keys(CATALOG_HEADERS) as CatalogMode[];
export const catalogIsKey = (data: string, key: KeyId) => data === key || matchesKey(data, key);
export const catalogPick = <T>(items: T[], indices: number[]): T[] =>
  indices.map((index) => items[index]).filter((item): item is T => item !== undefined);
const row = (cells: string[]): Row => ({ text: cells.join("  "), cells });
export const catalogProviderRow = ({ id, node }: CatalogProviderChoice): Row => {
  const key = node.apiKey;
  const shown = key === undefined ? M.missingKey : redactSecret(key);
  const url = node.baseUrl ?? E;
  const shownUrl = key === undefined ? url : url.split(key).join(shown);
  return row([id, shownUrl, node.api ?? E, `${M.keyLabel} ${shown}`]);
};
export const catalogRow = (model: CatalogModel): Row =>
  row([
    model.id,
    model.name ?? E,
    String(model.contextWindow),
    String(model.maxTokens),
    model.reasoning ? C.boolean.yes : C.boolean.no,
    model.vision ? C.boolean.yes : C.boolean.no,
  ]);
type TextOptions = { secret?: boolean; multiline?: boolean };
const textField = (key: string, label: string, value: string, options: TextOptions = {}): Field =>
  ({ kind: "text", key, label, value, ...options }) as Field;
const numberField = (key: string, label: string, value: number): Field =>
  ({ kind: "number", key, label, value, min: 0 }) as Field;
const selectField = (key: string, label: string, value: string, options: string[]): Field =>
  ({ kind: "select", key, label, value, options }) as Field;
const multiselectField = (key: string, label: string, value: string[], options: string[]): Field =>
  ({ kind: "multiselect", key, label, value, options }) as Field;
export const catalogManualFields = (model?: CatalogModel): Field[] => {
  const { labels, boolean } = C;
  const value = { ...CATALOG_DEFAULTS, ...model };
  const options = [boolean.yes, boolean.no];
  return [
    textField("id", labels.id, value.id ?? E),
    textField("name", labels.name, value.name ?? E),
    selectField("reasoning", labels.reasoning, value.reasoning ? boolean.yes : boolean.no, options),
    selectField("vision", labels.vision, value.vision ? boolean.yes : boolean.no, options),
    numberField("contextWindow", labels.contextWindow, value.contextWindow),
    numberField("maxTokens", labels.maxTokens, value.maxTokens),
  ];
};
export const updateCatalog = (
  config: ConfigStore,
  fn: (catalog: CatalogModel[]) => CatalogModel[],
): Promise<void> => config.update((value) => Object.assign(value, { catalog: fn(value.catalog) }));
export const fitCatalogBody = (
  lines: string[],
  width: number,
  listRows: number,
  focusLine = 0,
): string[] =>
  lines
    .slice(Math.max(0, focusLine - listRows + 1))
    .slice(0, listRows)
    .map((line) => truncateToWidth(line, width))
    .concat(Array(Math.max(0, listRows - lines.length)).fill(E));
export function renderModelManagerConfirm(
  confirm: Confirm | undefined,
  title: string,
  width: number,
  listRows: number,
): string[] {
  return [
    theme.title(truncateToWidth(title, width)),
    ...fitCatalogBody(confirm?.render(width) ?? [], width, listRows),
  ];
}
type Values = Record<string, unknown>;
const text = (values: Values, field: string): string =>
  typeof values[field] === "string" ? (values[field] as string) : E;
const finite = (value: unknown): number | undefined =>
  Number.isFinite(Number(value)) ? Number(value) : undefined;
const positive = (value: unknown): number | undefined => {
  const result = Number(typeof value === "string" ? value.trim() : value);
  return Number.isFinite(result) && result > 0 ? result : undefined;
};
type Fail = (message: string) => void;
type FormSubmit = (values: Values, fail: Fail) => Promise<void> | void;
class FormView implements TabComponent {
  private pending = Promise.resolve();
  private readonly form: Form;
  constructor(
    fields: Field[],
    private readonly title: string,
    notify: (message: string) => void,
    failure: string,
    submit: FormSubmit,
    cancel: () => void,
  ) {
    const fail = (message: string): void => notify(message);
    this.form = new Form(
      fields,
      (values) => {
        this.pending = Promise.resolve(submit(values, fail)).catch(() => fail(failure));
      },
      cancel,
    );
  }
  render = (width: number, rows: number): string[] => [
    theme.title(truncateToWidth(this.title, width)),
    ...fitCatalogBody(this.form.render(width), width, rows, this.form.focus),
  ];
  handleInput(data: string): void | Promise<void> {
    this.form.handleInput(data);
    return this.pending;
  }
  isEditing(): boolean {
    return this.form.isEditing();
  }
  hints = (): Array<[string, string]> => S.hints.form;
  helpTitle = (): string => this.title;
}
async function persist(
  options: Pick<ModelManagerDeps, "modelsFile" | "registrar">,
  update: (models: ModelsJson) => ModelsJson,
  done: (models: ModelsJson) => void,
): Promise<void> {
  const next = await options.modelsFile.update(update);
  options.registrar.syncOwned(next);
  done(next);
}
export type ProviderMode = "full" | "rename" | "multiplier";
export interface ProviderFormOptions extends ModelManagerDeps {
  providerId?: string;
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
function providerFields(provider: ProviderNode | undefined, mode: ProviderMode): Field[] {
  const labels = P.labels;
  const nameField = (value: string): Field => textField("name", labels.name, value);
  const mField = (value: string): Field => textField("multiplier", labels.multiplier, value);
  const multiplier = provider?.piModelFailover?.costMultiplier,
    authHeader = provider?.authHeader ? String(true) : E;
  if (mode === "rename") return [nameField(provider?.name ?? E)];
  if (mode === "multiplier") return [mField(String(multiplier ?? 1))];
  return [
    textField("name", labels.name, provider?.name ?? E),
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
      providerFields(provider, mode),
      providerTitle(mode, providerId === undefined),
      options.notify,
      P.saveFailed,
      (values, fail) => this.submit(values, mode, fail),
      options.onCancel,
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
    const id = this.options.providerId ?? parsed.name;
    return save((models) => {
      const updated = upsertProvider(models, id, buildProviderNode(parsed, models.providers[id]));
      return parsed.multiplier === undefined
        ? updated
        : setMultiplier(updated, id, parsed.multiplier);
    });
  }
}
export interface ModelFormOptions extends ModelManagerDeps {
  providerId: string;
  modelId: string;
  onDone: (models: ModelsJson) => void;
  onCancel: () => void;
}
function modelFields(node: ModelNode | undefined): Field[] {
  const labels = F.labels;
  const [yes, no] = [F.boolean.yes, F.boolean.no],
    inputOptions = [...F.inputOptions];
  return [
    textField("name", labels.name, node?.name ?? E),
    selectField("reasoning", labels.reasoning, node?.reasoning ? yes : no, [yes, no]),
    multiselectField("input", labels.input, node?.input ?? inputOptions.slice(0, 1), inputOptions),
    numberField("contextWindow", labels.contextWindow, node?.contextWindow ?? 0),
    numberField("maxTokens", labels.maxTokens, node?.maxTokens ?? 0),
    textField("costInput", labels.costInput, String(node?.cost.input ?? 0)),
    textField("costOutput", labels.costOutput, String(node?.cost.output ?? 0)),
    textField("costCacheRead", labels.costCacheRead, String(node?.cost.cacheRead ?? 0)),
    textField("costCacheWrite", labels.costCacheWrite, String(node?.cost.cacheWrite ?? 0)),
  ];
}
type ModelNumbers = [number, number, number, number, number, number];
function updateModel(node: ModelNode, values: Values): ModelNode | string {
  const numbers = `contextWindow maxTokens costInput costOutput costCacheRead costCacheWrite`
    .split(" ")
    .map((field) => finite(values[field]));
  if (numbers.some((value) => value === undefined)) return F.invalidNumbers;
  const [contextWindow, maxTokens, inputCost, outputCost, cacheRead, cacheWrite] =
    numbers as ModelNumbers;
  const next = structuredClone(node);
  const name = text(values, "name").trim();
  if (!name) Reflect.deleteProperty(next, "name");
  else next.name = name;
  Object.assign(next, {
    reasoning: values.reasoning === F.boolean.yes,
    input: Array.isArray(values.input) ? values.input.filter(isInput) : [],
    contextWindow,
    maxTokens,
    cost: { input: inputCost, output: outputCost, cacheRead, cacheWrite },
  });
  return next;
}
const isInput = (value: unknown): value is "text" | "image" =>
  ["text", "image"].includes(value as string);
function updateProviderModels(
  models: ModelsJson,
  providerId: string,
  update: (models: ModelNode[]) => ModelNode[],
): ModelsJson {
  const provider = models.providers[providerId];
  if (provider === undefined) return models;
  return upsertProvider(models, providerId, { ...provider, models: update(provider.models) });
}
export class ModelForm extends FormView {
  constructor(private readonly options: ModelFormOptions) {
    const node = options.initialModels.providers[options.providerId]?.models.find(
      ({ id }) => id === options.modelId,
    );
    super(
      modelFields(node),
      F.title,
      options.notify,
      F.saveFailed,
      (values, fail) => this.submit(values, node, fail),
      options.onCancel,
    );
  }
  private async submit(values: Values, original: ModelNode | undefined, fail: Fail): Promise<void> {
    if (original === undefined) return fail(F.missingModel);
    const validated = updateModel(original, values);
    if (typeof validated === "string") return fail(validated);
    return persist(
      this.options,
      (models) =>
        updateProviderModels(models, this.options.providerId, (providerModels) =>
          providerModels.map((model) =>
            model.id === this.options.modelId ? (updateModel(model, values) as ModelNode) : model,
          ),
        ),
      this.options.onDone,
    );
  }
}
export async function syncProviderAttributes(
  deps: Pick<ModelManagerDeps, "modelsFile">,
  providerId: string,
  modelIds: string[],
  catalog: CatalogModel[],
): Promise<ModelsJson> {
  const byId = new Map(catalog.map((model) => [model.id, model] as const));
  const selected = modelIds.length === 0 ? undefined : new Set(modelIds);
  return deps.modelsFile.update((models) =>
    updateProviderModels(models, providerId, (providerModels) =>
      providerModels.map((model) => {
        const source = byId.get(model.id);
        return source !== undefined && (selected === undefined || selected.has(model.id))
          ? syncAttributes(model, source)
          : model;
      }),
    ),
  );
}
