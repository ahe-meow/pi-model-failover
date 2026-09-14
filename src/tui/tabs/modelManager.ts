import { Key, truncateToWidth } from "@earendil-works/pi-tui";
import { chainsReferencing } from "../../domain/chains.js";
import type { Fetch } from "../../domain/ports.js";
import { deleteProvider, removeModel } from "../../domain/providers.js";
import type { ModelNode, ModelsJson, ProviderNode } from "../../domain/types.js";
import { S } from "../../strings.js";
import { Confirm } from "../primitives/confirm.js";
import { ScrollList } from "../primitives/scrollList.js";
import { tableColumns } from "../primitives/table.js";
import { draft } from "../primitives/textFilter.js";
import { theme } from "../primitives/theme.js";
import type { TabComponent } from "./history.js";
import { CatalogScreen } from "./modelManager/catalogScreen.js";
import { emptyModelManagerDeps } from "./modelManager/deps.js";
import { ModelManagerFilters } from "./modelManager/filters.js";
import {
  catalogIsKey as isKey,
  ModelForm,
  ProviderForm,
  renderModelManagerConfirm,
  syncProviderAttributes,
} from "./modelManager/forms.js";
import { KeyGroupForm } from "./modelManager/keyGroupForm.js";
import { markedModelIds, syncModelMarks as syncMarks } from "./modelManager/marks.js";
import {
  detailHeader,
  filteredModelRows,
  filteredProviderRows,
  move,
  selectedProvider,
} from "./modelManager/rows.js";
import { type ModelManagerDeps, PROVIDER_MODES, type Screen } from "./modelManager/types.js";

export type { ModelManagerDeps } from "./modelManager/types.js";
export class ModelManagerTab implements TabComponent {
  private readonly providerList = new ScrollList({
    listRows: 7,
    columns: tableColumns(S.modelManager.providerHeader),
  });
  private readonly modelList = new ScrollList({
    listRows: 7,
    multiSelect: true,
    columns: tableColumns(S.modelManager.modelHeader),
  });
  private readonly deps: ModelManagerDeps;
  private models: ModelsJson;
  private screen: Screen = "list";
  private selectedProviderId: string | undefined;
  private form: TabComponent | undefined;
  private formBack: (() => void) | undefined;
  private catalogScreen: CatalogScreen | undefined;
  private confirm: Confirm | undefined;
  private pending: Promise<void> | undefined;
  private readonly filters = new ModelManagerFilters();
  private readonly markedModelIds = new Set<string>();
  private visibleProviders: ReturnType<typeof filteredProviderRows>["providers"] = [];
  private visibleModels: ModelNode[] = [];
  constructor(deps: ModelManagerDeps = emptyModelManagerDeps()) {
    this.deps = deps;
    this.models = structuredClone(deps.initialModels);
    this.setProviderRows();
  }
  render(width: number, listRows: number): string[] {
    this.providerList.setListRows(listRows);
    this.modelList.setListRows(listRows);
    const filter = this.filters.active(this.screen);
    if (filter?.isEditing) return draft(width, filter, listRows, this.screen === "detail");
    if (this.confirm !== undefined)
      return renderModelManagerConfirm(
        this.confirm,
        this.screen === "detail" ? S.modelManager.modelForm.title : S.modelManager.providerHeader,
        width,
        listRows,
      );
    if (this.screen === "form") return this.form?.render(width, listRows) ?? [];
    if (this.screen === "catalog") return this.catalogScreen?.render(width, listRows) ?? [];
    return this.screen === "detail" ? this.renderDetail(width, listRows) : this.renderList(width);
  }
  handleInput(data: string): void | Promise<void> {
    const filter = this.filters.active(this.screen);
    if (filter?.isEditing) {
      if (filter.handleInput(data) === "applied") this.refreshFilteredRows();
      return;
    }
    if (this.confirm !== undefined) {
      this.confirm.handleInput(data);
      return this.waitForPending();
    }
    if (this.screen === "form") {
      if (isKey(data, Key.escape) && !this.form?.isEditing?.()) this.formBack?.();
      else return this.form?.handleInput(data);
      return;
    }
    if (this.screen === "catalog") return this.catalogScreen?.handleInput(data);
    if (this.screen === "detail") return this.handleDetailInput(data);
    if (isKey(data, Key.slash)) this.filters.active(this.screen)?.open();
    else if (data === "a") this.openProviderForm();
    else if (data === "d") this.openProviderDelete();
    else if (data === "m") this.openProviderForm(PROVIDER_MODES[2]);
    else if (data === "r") this.openProviderForm(PROVIDER_MODES[1]);
    else if (data === "k") this.openKeyGroupForm();
    else if (data === "c") this.openCatalog();
    else if (isKey(data, Key.enter)) this.openSelectedProvider();
    else if (isKey(data, Key.escape) && this.filters.provider.clear()) this.setProviderRows();
    else move(this.providerList, data);
  }
  isEditing = (): boolean =>
    this.filters.isEditing(
      this.screen,
      Boolean(this.form?.isEditing?.() || this.catalogScreen?.isEditing?.()),
    );
  hints(): Array<[string, string]> {
    if (this.filters.active(this.screen)?.isEditing) return S.hints.form;
    if (this.confirm !== undefined) return S.hints.confirm;
    if (this.screen === "form") return this.form?.hints() ?? S.hints.modelManager.list;
    if (this.screen === "catalog") return this.catalogScreen?.hints() ?? S.hints.modelManager.list;
    return this.screen === "detail" ? S.hints.modelManager.detail : S.hints.modelManager.list;
  }
  helpTitle(): string {
    if (this.confirm !== undefined) return S.tabs[0];
    if (this.screen === "form") return this.form?.helpTitle() ?? S.tabs[0];
    if (this.screen === "catalog") return this.catalogScreen?.helpTitle() ?? S.tabs[0];
    return S.tabs[0];
  }
  refresh(models: ModelsJson): void {
    this.models = structuredClone(models);
    this.setProviderRows();
    if (this.screen === "catalog") this.catalogScreen?.refresh(this.models);
    if (this.screen !== "detail") return;
    const provider = selectedProvider(this.models, this.selectedProviderId);
    if (provider === undefined) {
      this.screen = "list";
      this.selectedProviderId = undefined;
      return;
    }
    this.setModelRows(provider);
  }
  private refreshFilteredRows(): void {
    if (this.screen === "list") {
      this.setProviderRows();
      return;
    }
    const provider = selectedProvider(this.models, this.selectedProviderId);
    if (this.screen === "detail" && provider !== undefined) this.setModelRows(provider);
  }
  private handleDetailInput(data: string): void | Promise<void> {
    if (isKey(data, Key.escape)) {
      if (this.filters.model.clear()) {
        const provider = selectedProvider(this.models, this.selectedProviderId);
        if (provider !== undefined) this.setModelRows(provider);
        return;
      }
      this.screen = "list";
      this.modelList.setRows([]);
      this.visibleModels = [];
      this.selectedProviderId = undefined;
    } else if (isKey(data, Key.slash)) this.filters.active(this.screen)?.open();
    else if (data === "a") this.openCatalog(this.selectedProviderId);
    else if (data === "d") this.openRemoveModels();
    else if (data === "s") this.openSyncModels();
    else if (data === "e") this.openProviderForm(PROVIDER_MODES[0]);
    else if (isKey(data, Key.space)) {
      this.modelList.toggleMark();
      syncMarks(this.visibleModels, this.modelList, this.markedModelIds);
    } else if (isKey(data, Key.enter)) this.openModelForm();
    else move(this.modelList, data);
  }
  private setProviderRows(): void {
    const result = filteredProviderRows(this.models, this.filters.provider.query);
    this.visibleProviders = result.providers;
    this.providerList.setRows(result.rows);
  }
  private setModelRows(provider: ProviderNode): void {
    syncMarks(this.visibleModels, this.modelList, this.markedModelIds);
    const result = filteredModelRows(
      provider,
      this.deps.config.get().catalog,
      this.filters.model.query,
      this.markedModelIds,
    );
    this.visibleModels = result.models;
    this.modelList.setRows(result.rows);
  }
  private openSelectedProvider(): void {
    const entry = this.visibleProviders[this.providerList.selected];
    if (entry === undefined) return;
    this.selectedProviderId = entry.id;
    this.markedModelIds.clear();
    this.filters.model.reset();
    this.modelList.setRows([]);
    this.visibleModels = [];
    this.screen = "detail";
    this.setModelRows(entry.node);
  }
  private openCatalog(targetProviderId?: string): void {
    const fetch = this.deps.fetch ?? ((async () => new Response(null, { status: 503 })) as Fetch);
    const runtimeFactory = this.deps.runtimeFactory ?? (async () => ({ getModels: () => [] }));
    const back: Screen = this.screen === "detail" ? "detail" : "list";
    this.catalogScreen = new CatalogScreen({
      ...this.deps,
      initialModels: this.models,
      fetch,
      runtimeFactory,
      ...(targetProviderId === undefined ? {} : { targetProviderId }),
      onDone: (models) => {
        this.models = structuredClone(models);
        this.setProviderRows();
        if (targetProviderId === undefined) return;
        this.screen = "detail";
        const provider = this.models.providers[targetProviderId];
        if (provider !== undefined) this.setModelRows(provider);
        this.catalogScreen = undefined;
      },
      onBack: () => {
        this.catalogScreen = undefined;
        this.screen = back;
      },
    });
    this.screen = "catalog";
  }
  private openKeyGroupForm(): void {
    this.formBack = () => {
      this.closeForm("list");
      this.deps.notify(S.modelManager.keyGroupForm.cancelled);
    };
    // biome-ignore format: keep the form callback wiring compact
    this.form = new KeyGroupForm({ ...this.deps, onDone: (models) => this.finishForm(models, "list") });
    this.screen = "form";
  }
  private openProviderForm(mode: "full" | "rename" | "multiplier" = "full"): void {
    const back: Screen = this.screen === "detail" ? "detail" : "list";
    if (mode !== "full" && this.visibleProviders[this.providerList.selected] === undefined) return;
    const providerId =
      mode === "full"
        ? { detail: this.selectedProviderId, list: undefined }[back]
        : this.visibleProviders[this.providerList.selected]?.id;
    this.formBack = () => this.closeForm(back);
    this.form = new ProviderForm({
      ...this.deps,
      initialModels: this.models,
      ...(providerId === undefined ? {} : { providerId }),
      mode,
      onDone: (models) => this.finishForm(models, back),
      onCancel: () => this.closeForm(back),
    });
    this.screen = "form";
  }
  private openModelForm(): void {
    const providerId = this.selectedProviderId;
    const model = this.visibleModels[this.modelList.selected];
    if (providerId === undefined || model === undefined) return;
    this.formBack = () => this.closeForm("detail");
    this.form = new ModelForm({
      ...this.deps,
      initialModels: this.models,
      providerId,
      modelId: model.id,
      onDone: (models) => this.finishForm(models, "detail"),
      onCancel: () => this.closeForm("detail"),
    });
    this.screen = "form";
  }
  private closeForm(back: Screen): void {
    this.form = undefined;
    this.formBack = undefined;
    this.screen = back;
  }
  private finishForm(models: ModelsJson, back: Screen): void {
    this.models = structuredClone(models);
    this.closeForm(back);
    this.setProviderRows();
    if (back !== "detail") return;
    const provider = selectedProvider(this.models, this.selectedProviderId);
    if (provider !== undefined) this.setModelRows(provider);
  }
  private selectedModelIds(): string[] {
    if (this.filters.model.query !== "" && this.visibleModels.length === 0) return [];
    syncMarks(this.visibleModels, this.modelList, this.markedModelIds);
    const marked = markedModelIds(
      selectedProvider(this.models, this.selectedProviderId),
      this.markedModelIds,
    );
    const selected = this.visibleModels[this.modelList.selected]?.id;
    if (marked.length > 0) return marked;
    return selected === undefined ? [] : [selected];
  }
  private openRemoveModels(): void {
    const providerId = this.selectedProviderId;
    const ids = this.selectedModelIds();
    if (providerId === undefined || ids.length === 0) return;
    this.ask(
      S.modelManager.actions.removeModelsTitle(ids.length),
      [S.modelManager.actions.removeModelsDetails],
      async () => {
        const next = await this.deps.modelsFile.update((models) =>
          ids.reduce((current, id) => removeModel(current, providerId, id), models),
        );
        this.completeModels(next, "detail");
      },
    );
  }
  private openSyncModels(): void {
    const providerId = this.selectedProviderId;
    const provider = selectedProvider(this.models, this.selectedProviderId);
    if (
      (this.filters.model.query !== "" && this.visibleModels.length === 0) ||
      providerId === undefined ||
      provider === undefined ||
      provider.models.length === 0
    )
      return;
    syncMarks(this.visibleModels, this.modelList, this.markedModelIds);
    const ids = markedModelIds(
      selectedProvider(this.models, this.selectedProviderId),
      this.markedModelIds,
    );
    const count = ids.length === 0 ? provider.models.length : ids.length;
    this.ask(
      S.modelManager.actions.syncTitle(count),
      [S.modelManager.actions.syncDetails],
      async () => {
        const next = await syncProviderAttributes(
          this.deps,
          providerId,
          ids,
          this.deps.config.get().catalog,
        );
        this.completeModels(next, "detail");
      },
    );
  }
  private openProviderDelete(): void {
    const entry = this.visibleProviders[this.providerList.selected];
    if (entry === undefined) return;
    const affected = chainsReferencing(this.deps.config.get().chains, entry.id)
      .slice(0, 3)
      .map((chain) => chain.name);
    this.ask(
      S.modelManager.actions.deleteProviderTitle(entry.id),
      [
        S.modelManager.actions.deleteProviderAffected(affected),
        S.modelManager.actions.deleteProviderCleanup,
      ],
      async () => {
        const next = await this.deps.modelsFile.update((models) =>
          deleteProvider(models, entry.id),
        );
        await this.deps.afterProviderDelete?.(entry.id, next);
        this.finishModels(next, "list");
      },
    );
  }
  private ask(title: string, details: string[], action: () => Promise<void>): void {
    // biome-ignore format: keep confirmation callbacks together
    this.confirm = new Confirm(title, details, () => { this.confirm = undefined; this.start(action); }, () => (this.confirm = undefined));
  }
  private start(task: () => Promise<void>): void {
    this.pending = task().catch(() => this.deps.notify(S.modelManager.actions.saveFailed));
  }
  private async waitForPending(): Promise<void> {
    const operation = this.pending;
    if (operation === undefined) return;
    await operation;
    if (this.pending === operation) this.pending = undefined;
  }
  // biome-ignore format: keep the completion handoff compact
  private completeModels(models: ModelsJson, screen: Screen): void { this.deps.registrar.syncOwned(models); this.finishModels(models, screen); }
  private finishModels(models: ModelsJson, screen: Screen): void {
    this.models = structuredClone(models);
    this.screen = screen;
    this.setProviderRows();
    const provider =
      screen === "detail" ? selectedProvider(this.models, this.selectedProviderId) : undefined;
    if (provider === undefined) {
      this.selectedProviderId = undefined;
      this.screen = screen === "detail" ? "list" : screen;
      return;
    }
    this.setModelRows(provider);
  }
  private renderList(width: number): string[] {
    return [this.providerList.header(width), ...this.providerList.render(width)];
  }
  private renderDetail(width: number, listRows: number): string[] {
    const id = this.selectedProviderId;
    const provider = selectedProvider(this.models, this.selectedProviderId);
    if (id === undefined || provider === undefined) {
      this.screen = "list";
      return this.renderList(width);
    }
    this.modelList.setListRows(Math.max(0, listRows - 1));
    return [
      theme.title(truncateToWidth(detailHeader(id, provider), width)),
      this.modelList.header(width),
      ...this.modelList.render(width),
    ];
  }
}
export * from "./modelManager/forms.js";
