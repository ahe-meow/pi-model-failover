import { type KeyId, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../../../config/configStore.js";
import { CATALOG_DEFAULTS, syncAttributes } from "../../../domain/catalog.js";
import { upsertProvider } from "../../../domain/providers.js";
import { redactSecret } from "../../../domain/redact.js";
import type { CatalogModel, ModelNode, ModelsJson, ProviderNode } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import type { Field } from "../../primitives/form.js";
import type { Row } from "../../primitives/scrollList.js";
import type { ModelManagerDeps } from "../modelManager.js";
import {
  type Fail,
  FormView,
  multiselectField,
  numberField,
  persist,
  selectField,
  text,
  textField,
  type Values,
} from "./formView.js";

export { fitCatalogBody, renderModelManagerConfirm } from "./formView.js";
export { ProviderForm, type ProviderFormOptions, type ProviderMode } from "./providerForm.js";

const M = S.modelManager;
const { modelForm: F, catalog: C } = M,
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
const finite = (value: unknown): number | undefined =>
  Number.isFinite(Number(value)) ? Number(value) : undefined;
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
