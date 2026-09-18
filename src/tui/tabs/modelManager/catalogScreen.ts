import { Key, truncateToWidth } from "@earendil-works/pi-tui";
import { fetchEndpointModels, importPiBuiltinCatalog } from "../../../adapters/catalogImporters.js";
import {
  CATALOG_DEFAULTS,
  removeCatalogModel,
  upsertCatalogModel,
} from "../../../domain/catalog.js";
import type { Fetch } from "../../../domain/ports.js";
import type { CatalogModel, ModelsJson } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import { Confirm } from "../../primitives/confirm.js";
import type { Form } from "../../primitives/form.js";
import { MultiSelectList } from "../../primitives/multiSelectList.js";
import { tableColumns } from "../../primitives/table.js";
import { renderFilterDraft } from "../../primitives/textFilter.js";
import { theme } from "../../primitives/theme.js";
import type { TabComponent } from "../history.js";
import type { ModelManagerDeps } from "../modelManager.js";
import {
  catalogProviders,
  createCatalogFilters,
  dispatchCatalogSelection,
  filterCatalogLists,
  selectedCatalogIds,
  syncCatalogList,
} from "./catalogFilter.js";
import {
  createCatalogManualForm,
  parseCatalogModel,
  renderCatalogConfirm,
  renderCatalogManual,
} from "./catalogManual.js";
import { persistCatalog, persistModelsToProviders } from "./catalogPersistence.js";
import {
  CATALOG_HEADERS as HEADER,
  type ImportedCatalogMode as ImportedMode,
  catalogIsKey as isKey,
  CATALOG_MODES as MODES,
  type CatalogMode as Mode,
  catalogRow as modelRow,
  type CatalogProviderChoice as ProviderChoice,
  catalogPick as pick,
  catalogProviderRow as providerRow,
} from "./forms.js";

const CATALOG = S.modelManager.catalog;

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
        columns: tableColumns(
          mode.includes("provider") ? CATALOG.providerHeader : CATALOG.tableHeader,
        ),
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
  private listRows = 7;
  private manualForm: Form | undefined;
  private manualDefaults: Record<string, unknown> = {};
  private manualError: string | undefined;
  private confirm: Confirm | undefined;
  private error: string | undefined;
  private pending: Promise<void> | undefined;
  private readonly filters = createCatalogFilters();
  private visibleCatalogModels: CatalogModel[] = [];
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
    const dataRows = Math.max(0, this.listRows - 1);
    for (const list of Object.values(this.lists)) list.setListRows(dataRows);
    this.syncCatalog();
    const filter = this.filters[this.mode];
    if (filter.isEditing)
      return renderFilterDraft(
        width,
        S.filter.inputTitle,
        filter,
        2 + Math.max(0, this.listRows - 1),
      );
    if (this.manualForm !== undefined)
      return renderCatalogManual(this.manualForm, this.manualError, width, this.listRows);
    if (this.confirm !== undefined)
      return renderCatalogConfirm(this.confirm, this.header(), width, this.listRows);
    return [
      theme.title(truncateToWidth(this.header(), width)),
      this.lists[this.mode].header(width),
      ...this.lists[this.mode].render(width),
    ];
  }
  async handleInput(data: string): Promise<void> {
    const filter = this.filters[this.mode];
    if (filter.isEditing) {
      if (filter.handleInput(data) === "applied") this.applyFilter(this.mode);
      return;
    }
    if (this.manualForm !== undefined) {
      this.manualForm.handleInput(data);
      return this.waitForPending();
    }
    if (this.confirm !== undefined) {
      this.confirm.handleInput(data);
      return this.waitForPending();
    }
    if (this.mode === "catalog") {
      if (isKey(data, Key.slash)) this.filters.catalog.open();
      else if (data === "i") {
        this.setMode("endpoint-provider");
      } else if (data === "p") this.start(() => this.importBuiltin());
      else if (data === "+") this.openManual();
      else if (data === "e") {
        const marked = this.lists.catalog.markedIndices();
        if (this.visibleCatalogModels.length === 0) return;
        const model =
          marked.length > 0
            ? pick(this.catalogModels, marked)[0]
            : this.visibleCatalogModels[this.lists.catalog.selected];
        if (model !== undefined) this.openManual(model);
      } else if (data === "d") this.openDeleteConfirmation();
      else if (isKey(data, Key.escape) && this.filters.catalog.clear()) this.applyFilter("catalog");
      else if (isKey(data, Key.escape)) return void this.deps.onBack?.();
      else {
        this.lists.catalog.handleInput(data);
      }
      return this.waitForPending();
    }
    if (isKey(data, Key.escape)) {
      if (filter.clear()) {
        this.applyFilter(this.mode);
        return;
      }
      this.setMode(this.mode === "endpoint-models" ? "endpoint-provider" : "catalog");
      return;
    }
    if (isKey(data, Key.slash)) {
      filter.open();
      return;
    }
    this.lists[this.mode].handleInput(data);
    return this.waitForPending();
  }
  isEditing(): boolean {
    return this.filters[this.mode].isEditing || this.manualForm?.isEditing() || false;
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
  private applyFilter(mode: Mode): void {
    const visible = filterCatalogLists(
      mode,
      this.filters,
      this.lists,
      this.catalogModels,
      this.providers,
      this.importModels,
    );
    if (visible === undefined) return;
    this.visibleCatalogModels = visible;
  }
  private confirmSelection(mode: Mode, indices: number[]): void {
    dispatchCatalogSelection(
      mode,
      indices,
      this.catalogModels,
      this.importModels,
      this.deps.targetProviderId,
      {
        catalog: (selected, targetProviderId) => {
          if (targetProviderId === undefined) return this.enterProviderTargets(selected);
          this.providerModels = selected;
          this.start(() => this.saveToProviders([targetProviderId]));
        },
        endpointProvider: (selected) => this.beginEndpointSelection(selected),
        providerTargets: (selected) => this.beginProviderSave(selected),
        imported: (selected) => this.start(() => this.saveImported(selected)),
      },
    );
  }
  private header(): string {
    const title = HEADER[this.mode](this.catalogModels.length);
    return this.error === undefined ? title : `${title}  ${theme.danger(this.error)}`;
  }
  private syncCatalog(): void {
    this.catalogModels = syncCatalogList(
      this.deps.config.get().catalog,
      this.catalogModels,
      this.lists.catalog,
    );
    this.applyFilter("catalog");
  }
  private syncProviders(): void {
    this.providers = catalogProviders(this.models);
    this.lists["endpoint-provider"].setRows(this.providers.map(providerRow));
    this.lists["provider-targets"].setRows(this.providers.map(providerRow));
    this.applyFilter("endpoint-provider");
    this.applyFilter("provider-targets");
  }
  private enterProviderTargets(models: CatalogModel[]): void {
    if (models.length === 0) return;
    this.providerModels = models.map((model) => structuredClone(model));
    this.filters["provider-targets"].reset();
    this.lists["provider-targets"].setRows(this.providers.map(providerRow));
    this.applyFilter("provider-targets");
    this.setMode("provider-targets");
  }
  private beginEndpointSelection(indices: number[]): void {
    const id = pick(this.providers, indices)[0]?.id;
    if (id !== undefined) this.start(() => this.beginEndpointImport(id));
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
    this.filters[mode].reset();
    this.importModels = models;
    this.lists[mode].setRows(models.map(modelRow));
    this.applyFilter(mode);
    this.setMode(mode);
  }
  private async saveImported(selected: CatalogModel[]): Promise<void> {
    if (selected.length === 0) return void this.setMode("catalog");
    // biome-ignore format: keep the import selection handoff compact
    await this.writeCatalog((catalog) => selected.reduce(upsertCatalogModel, catalog), () => this.setMode("catalog"));
    const first = selected[0],
      index =
        first === undefined ? -1 : this.visibleCatalogModels.findIndex(({ id }) => id === first.id),
      sourceIndex = this.catalogModels.findIndex(({ id }) => id === first?.id);
    if (index < 0) return void this.lists.catalog.mark(sourceIndex);
    this.lists.catalog.handleInput(Key.home);
    for (let step = 0; step < index; step++) this.lists.catalog.handleInput(Key.down);
    // biome-ignore format: avoid toggling an already-marked imported model
    if (!this.lists.catalog.markedIndices().includes(sourceIndex)) this.lists.catalog.handleInput(Key.space);
  }
  private async saveToProviders(providerIds: string[]): Promise<void> {
    if (providerIds.length === 0 || this.providerModels.length === 0) {
      this.setMode("catalog");
      return;
    }
    await persistModelsToProviders(
      this.deps.modelsFile,
      this.providerModels,
      providerIds,
      (next) => {
        this.models = structuredClone(next);
        this.syncProviders();
        this.deps.registrar.syncOwned(next);
        this.deps.onDone(next);
        this.setMode("catalog");
      },
      () => this.fail(S.modelManager.catalog.saveFailed),
    );
  }
  private openDeleteConfirmation(): void {
    if (this.visibleCatalogModels.length === 0) return;
    const ids = selectedCatalogIds(
      this.catalogModels,
      this.visibleCatalogModels,
      this.lists.catalog.selected,
      this.lists.catalog.markedIndices(),
    );
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
    this.manualForm = createCatalogManualForm(
      model,
      (values) => this.start(() => this.saveManual(values)),
      () => {
        this.manualForm = undefined;
        this.manualError = undefined;
      },
    );
  }
  private async saveManual(values: Record<string, unknown>): Promise<void> {
    const model = parseCatalogModel(values, this.manualDefaults);
    if (typeof model === "string") return this.manualFailure(model);
    return this.writeCatalog(
      (catalog) => upsertCatalogModel(catalog, model),
      () => {
        this.manualForm = undefined;
        this.manualError = undefined;
      },
      (message) => this.manualFailure(message),
    );
  }
  private async writeCatalog(
    update: (catalog: CatalogModel[]) => CatalogModel[],
    onSuccess: () => void = () => {},
    onFailure: (message: string) => void = (message) => this.fail(message),
  ): Promise<void> {
    if (!(await persistCatalog(this.deps.config, update)))
      return onFailure(S.modelManager.catalog.saveFailed);
    this.error = undefined;
    onSuccess();
    this.syncCatalog();
  }
  private manualFailure(message: string): void {
    this.manualError = message;
    this.deps.notify(message);
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
