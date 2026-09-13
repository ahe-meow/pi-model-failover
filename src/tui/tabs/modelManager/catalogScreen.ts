import { Key, truncateToWidth } from "@earendil-works/pi-tui";
import { fetchEndpointModels, importPiBuiltinCatalog } from "../../../adapters/catalogImporters.js";
import {
  CATALOG_DEFAULTS,
  removeCatalogModel,
  toModelNode,
  upsertCatalogModel,
} from "../../../domain/catalog.js";
import type { Fetch } from "../../../domain/ports.js";
import { addModelToProviders } from "../../../domain/providers.js";
import type { CatalogModel, ModelsJson } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import { Confirm } from "../../primitives/confirm.js";
import { Form } from "../../primitives/form.js";
import { MultiSelectList } from "../../primitives/multiSelectList.js";
import type { TabComponent } from "../history.js";
import type { ModelManagerDeps } from "../modelManager.js";
import {
  catalogRow,
  catalogFinite as finite,
  fitCatalogBody,
  CATALOG_HEADERS as HEADER,
  type ImportedCatalogMode as ImportedMode,
  catalogIsKey as isKey,
  CATALOG_MODES as MODES,
  type CatalogMode as Mode,
  catalogManualFields as manualFields,
  catalogModelRow as modelRow,
  nextCatalogCursor as nextCursor,
  type CatalogProviderChoice as ProviderChoice,
  catalogPick as pick,
  catalogProviderRow as providerRow,
  updateCatalog,
} from "./forms.js";

export interface CatalogScreenDeps extends ModelManagerDeps {
  fetch: Fetch;
  runtimeFactory: () => Promise<{ getModels(): unknown[] }>;
  onDone: (models: ModelsJson) => void;
  onBack?: () => void;
  targetProviderId?: string;
}
export class CatalogScreen implements TabComponent {
  private readonly deps: CatalogScreenDeps;
  private readonly lists = Object.fromEntries(
    MODES.map((mode) => [
      mode,
      new MultiSelectList({
        listRows: 7,
        onConfirm: (indices) => this.confirmSelection(mode, indices),
      }),
    ]),
  ) as Record<Mode, MultiSelectList>;
  private mode: Mode = "catalog";
  private models: ModelsJson;
  private providers: ProviderChoice[] = [];
  private catalogModels: CatalogModel[] = [];
  private importModels: CatalogModel[] = [];
  private providerModels: CatalogModel[] = [];
  private catalogCursor = 0;
  private listRows = 7;
  private manualForm: Form | undefined;
  private manualDefaults: Record<string, unknown> = {};
  private manualError: string | undefined;
  private confirm: Confirm | undefined;
  private error: string | undefined;
  private pending: Promise<void> | undefined;
  constructor(deps: CatalogScreenDeps) {
    this.deps = deps;
    this.models = structuredClone(deps.initialModels);
    this.syncCatalog();
    this.syncProviders();
  }
  refresh(models: ModelsJson): void {
    this.models = structuredClone(models);
    this.syncProviders();
  }

  async beginEndpointImport(providerId: string): Promise<void> {
    const provider = this.models.providers[providerId];
    if (provider?.baseUrl === undefined)
      return this.fail(S.modelManager.catalog.endpointImportFailed);
    const template = {
      baseUrl: provider.baseUrl,
      ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
      ...(provider.headers === undefined ? {} : { headers: provider.headers }),
    };
    try {
      const ids = await fetchEndpointModels(this.deps.fetch, template);
      this.enterImport(
        "endpoint-models",
        ids.map((id) => ({ id, ...CATALOG_DEFAULTS })),
      );
    } catch {
      this.fail(S.modelManager.catalog.endpointImportFailed);
    }
  }

  async beginProviderAdd(modelId: string): Promise<void> {
    const model = this.deps.config.get().catalog.find((candidate) => candidate.id === modelId);
    if (model === undefined) return this.fail(S.modelManager.catalog.saveFailed);
    this.enterProviderTargets([model]);
  }

  render(width: number, listRows: number): string[] {
    this.listRows = Math.max(0, listRows);
    for (const list of Object.values(this.lists)) list.setListRows(this.listRows);
    this.syncCatalog();
    if (this.manualForm !== undefined) return this.renderManual(width);
    if (this.confirm !== undefined) return this.renderConfirm(width);
    return [truncateToWidth(this.header(), width), ...this.lists[this.mode].render(width)];
  }

  async handleInput(data: string): Promise<void> {
    if (this.manualForm !== undefined) {
      this.manualForm.handleInput(data);
      return this.waitForPending();
    }
    if (this.confirm !== undefined) {
      this.confirm.handleInput(data);
      return this.waitForPending();
    }
    if (this.mode === "catalog") {
      if (data === "i") {
        this.setMode("endpoint-provider");
      } else if (data === "p") this.start(() => this.importBuiltin());
      else if (data === "+") this.openManual();
      else if (data === "e") {
        const model =
          this.catalogModels[this.lists.catalog.markedIndices()[0] ?? this.catalogCursor];
        if (model !== undefined) this.openManual(model);
      } else if (data === "d") this.openDeleteConfirmation();
      else if (isKey(data, Key.escape)) return void this.deps.onBack?.();
      else {
        this.catalogCursor = nextCursor(
          data,
          this.catalogCursor,
          this.catalogModels.length,
          this.listRows,
        );
        this.lists.catalog.handleInput(data);
      }
      return this.waitForPending();
    }
    if (isKey(data, Key.escape)) {
      this.setMode(this.mode === "endpoint-models" ? "endpoint-provider" : "catalog");
      return;
    }
    this.lists[this.mode].handleInput(data);
    return this.waitForPending();
  }

  hints(): Array<[string, string]> {
    if (this.manualForm !== undefined) return S.hints.form;
    if (this.confirm !== undefined) return S.hints.confirm;
    return this.mode === "catalog"
      ? S.hints.modelManager.catalog
      : S.hints.modelManager.catalogSelect;
  }

  helpTitle(): string {
    return this.manualForm === undefined
      ? S.modelManager.catalog.title
      : S.modelManager.catalog.manualTitle;
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.error = undefined;
  }

  private confirmSelection(mode: Mode, indices: number[]): void {
    if (mode === "catalog") {
      const selected = pick(this.catalogModels, indices);
      if (this.deps.targetProviderId !== undefined) {
        this.providerModels = selected;
        this.start(() => this.saveToProviders([this.deps.targetProviderId as string]));
      } else {
        this.enterProviderTargets(selected);
      }
      return;
    }
    if (mode === "endpoint-provider") {
      this.beginEndpointSelection(indices);
      return;
    }
    if (mode === "provider-targets") {
      this.beginProviderSave(indices);
      return;
    }
    this.start(() => this.saveImported(pick(this.importModels, indices)));
  }

  private header(): string {
    const title = HEADER[this.mode](this.catalogModels.length);
    return this.error === undefined ? title : `${title}  ${this.error}`;
  }

  private syncCatalog(): void {
    const marked = new Set(
      pick(this.catalogModels, this.lists.catalog.markedIndices()).map(({ id }) => id),
    );
    this.catalogModels = this.deps.config.get().catalog.map((model) => structuredClone(model));
    this.lists.catalog.setRows(
      this.catalogModels.map((model) => ({
        ...catalogRow(model),
        ...(marked.has(model.id) ? { marked: true } : {}),
      })),
    );
    this.catalogCursor = Math.min(this.catalogCursor, Math.max(0, this.catalogModels.length - 1));
  }

  private syncProviders(): void {
    this.providers = Object.entries(this.models.providers)
      .filter(([id]) => id !== "failover")
      .map(([id, node]) => ({ id, node: structuredClone(node) }));
    this.lists["endpoint-provider"].setRows(this.providers.map(providerRow));
    this.lists["provider-targets"].setRows(this.providers.map(providerRow));
  }

  private enterProviderTargets(models: CatalogModel[]): void {
    if (models.length === 0) return;
    this.providerModels = models.map((model) => structuredClone(model));
    this.lists["provider-targets"].setRows(this.providers.map(providerRow));
    this.setMode("provider-targets");
  }

  private beginEndpointSelection(indices: number[]): void {
    const providerId = pick(this.providers, indices)[0]?.id;
    if (providerId !== undefined) this.start(() => this.beginEndpointImport(providerId));
  }

  private beginProviderSave(indices: number[]): void {
    this.start(() => this.saveToProviders(pick(this.providers, indices).map(({ id }) => id)));
  }

  private async importBuiltin(): Promise<void> {
    try {
      this.enterImport("builtin-models", await importPiBuiltinCatalog(this.deps.runtimeFactory));
    } catch {
      this.fail(S.modelManager.catalog.builtinImportFailed);
    }
  }

  private enterImport(mode: ImportedMode, models: CatalogModel[]): void {
    this.importModels = models;
    this.lists[mode].setRows(models.map(modelRow));
    this.setMode(mode);
  }

  private saveImported(selected: CatalogModel[]): Promise<void> {
    if (selected.length === 0) {
      this.setMode("catalog");
      return Promise.resolve();
    }
    return this.writeCatalog(
      (catalog) => selected.reduce(upsertCatalogModel, catalog),
      () => {
        this.setMode("catalog");
      },
    );
  }

  private async saveToProviders(providerIds: string[]): Promise<void> {
    if (providerIds.length === 0 || this.providerModels.length === 0) {
      this.setMode("catalog");
      return;
    }
    try {
      const nodes = this.providerModels.map(toModelNode);
      const next = await this.deps.modelsFile.update((models) =>
        nodes.reduce((current, node) => addModelToProviders(current, providerIds, node), models),
      );
      this.models = structuredClone(next);
      this.syncProviders();
      this.deps.registrar.syncOwned(next);
      this.deps.onDone(next);
      this.setMode("catalog");
    } catch {
      this.fail(S.modelManager.catalog.saveFailed);
    }
  }

  private openDeleteConfirmation(): void {
    const marked = this.lists.catalog.markedIndices();
    const selected = pick(this.catalogModels, marked.length === 0 ? [this.catalogCursor] : marked);
    const ids = selected.map(({ id }) => id);
    if (ids.length === 0) return;
    this.confirm = new Confirm(
      S.modelManager.catalog.deleteTitle(ids.length),
      [S.modelManager.catalog.deleteDetails, S.modelManager.catalog.providerModelsUntouched],
      () => {
        this.confirm = undefined;
        this.start(() => this.deleteCatalog(ids));
      },
      () => {
        this.confirm = undefined;
      },
    );
  }

  private deleteCatalog(ids: string[]): Promise<void> {
    return this.writeCatalog((catalog) => ids.reduce(removeCatalogModel, catalog));
  }

  private openManual(model?: CatalogModel): void {
    this.manualError = undefined;
    this.manualDefaults = structuredClone(model?.defaults ?? CATALOG_DEFAULTS.defaults);
    this.manualForm = new Form(
      manualFields(model),
      (values) => this.start(() => this.saveManual(values)),
      () => {
        this.manualForm = undefined;
        this.manualError = undefined;
      },
    );
  }

  private async saveManual(values: Record<string, unknown>): Promise<void> {
    const id = typeof values.id === "string" ? values.id.trim() : String();
    if (id === "") return this.manualFailure(S.modelManager.catalog.invalidId);
    const contextWindow = values.contextWindow;
    const maxTokens = values.maxTokens;
    if (!finite(contextWindow) || !finite(maxTokens)) {
      return this.manualFailure(S.modelManager.catalog.invalidNumbers);
    }
    const name = typeof values.name === "string" ? values.name.trim() : String();
    const yes = S.modelManager.catalog.boolean.yes;
    const model: CatalogModel = {
      id,
      ...(name === "" ? {} : { name }),
      reasoning: values.reasoning === yes,
      vision: values.vision === yes,
      contextWindow,
      maxTokens,
      defaults: structuredClone(this.manualDefaults),
    };
    return this.writeCatalog(
      (catalog) => upsertCatalogModel(catalog, model),
      () => {
        this.manualForm = undefined;
        this.manualError = undefined;
      },
      (message) => this.manualFailure(message),
    );
  }

  private writeCatalog(
    update: (catalog: CatalogModel[]) => CatalogModel[],
    onSuccess: () => void = () => {},
    onFailure: (message: string) => void = (message) => this.fail(message),
  ): Promise<void> {
    return updateCatalog(this.deps.config, update)
      .then(() => {
        this.error = undefined;
        onSuccess();
        this.syncCatalog();
      })
      .catch(() => onFailure(S.modelManager.catalog.saveFailed));
  }

  private manualFailure(message: string): void {
    this.manualError = message;
    this.deps.notify(message);
  }

  private renderManual(width: number): string[] {
    const body = this.manualForm?.render(width) ?? [];
    if (this.manualError !== undefined) body.push(`    ${this.manualError}`);
    const focus = this.manualError === undefined ? (this.manualForm?.focus ?? 0) : body.length - 1;
    return [
      truncateToWidth(S.modelManager.catalog.manualTitle, width),
      ...fitCatalogBody(body, width, this.listRows, focus),
    ];
  }

  private renderConfirm(width: number): string[] {
    return [
      truncateToWidth(this.header(), width),
      ...fitCatalogBody(this.confirm?.render(width) ?? [], width, this.listRows),
    ];
  }

  private start(task: () => Promise<void>): void {
    this.pending = task().catch(() => this.fail(S.modelManager.catalog.saveFailed));
  }

  private async waitForPending(): Promise<void> {
    const operation = this.pending;
    if (operation === undefined) return;
    await operation;
    if (this.pending === operation) this.pending = undefined;
  }

  private fail(message: string): void {
    this.error = message;
    this.mode = "catalog";
    this.deps.notify(message);
  }
}
