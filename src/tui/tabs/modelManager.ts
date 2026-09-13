import { Key, truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../../config/configStore.js";
import { isDrifted } from "../../domain/catalog.js";
import { chainsReferencing } from "../../domain/chains.js";
import type { Fetch } from "../../domain/ports.js";
import { deleteProvider, listProviders, removeModel } from "../../domain/providers.js";
import { redactSecret } from "../../domain/redact.js";
import type { CatalogModel, ModelNode, ModelsJson, ProviderNode } from "../../domain/types.js";
import { S } from "../../strings.js";
import { Confirm } from "../primitives/confirm.js";
import { type Row, ScrollList } from "../primitives/scrollList.js";
import type { TabComponent } from "./history.js";
import { CatalogScreen } from "./modelManager/catalogScreen.js";
import { emptyModelManagerDeps } from "./modelManager/deps.js";
import {
  fitCatalogBody,
  catalogIsKey as isKey,
  ModelForm,
  ProviderForm,
  syncProviderAttributes,
} from "./modelManager/forms.js";
import { KeyGroupForm } from "./modelManager/keyGroupForm.js";

const PROVIDER_MODES = ["full", "rename", "multiplier"] as const;
function providerRow(entry: ReturnType<typeof listProviders>[number]): Row {
  const owner = entry.owned
    ? S.modelManager.failoverOwner
    : entry.node.piModelManager?.managed
      ? S.modelManager.pmmOwner
      : String();
  const multiplier =
    entry.multiplier === null
      ? String()
      : `${entry.multiplier.toFixed(2)}${S.modelManager.multiplierSuffix}`;
  return {
    text: `${entry.id}  ${entry.node.api}  ${entry.node.models.length}  ${multiplier}  ${owner}`,
  };
}
function modelRow(node: ModelNode, catalog: CatalogModel[]): Row {
  const source = catalog.find(({ id }) => id === node.id);
  const drift =
    source !== undefined && isDrifted(node, source) ? ` ${S.modelManager.driftMarker}` : String();
  return {
    text: `${node.id}  ${node.contextWindow} ${S.modelManager.contextLabel}  ${node.maxTokens} ${S.modelManager.maxTokensLabel}  ${node.reasoning ? S.modelManager.reasoningLabel : S.modelManager.notReasoning}${drift}`,
  };
}
function detailHeader(id: string, provider: ProviderNode): string {
  const key =
    provider.apiKey === undefined ? S.modelManager.missingKey : redactSecret(provider.apiKey);
  let url: string = S.modelManager.missingKey;
  if (provider.baseUrl !== undefined) {
    url =
      provider.apiKey === undefined
        ? provider.baseUrl
        : provider.baseUrl.split(provider.apiKey).join(key);
  }
  const multiplier =
    provider.piModelFailover === undefined
      ? String()
      : `${provider.piModelFailover.costMultiplier.toFixed(2)}${S.modelManager.multiplierSuffix}`;
  return `${id}  ${url}  ${provider.api}  ${S.modelManager.keyLabel} ${key}  ${multiplier}`;
}
function move(list: ScrollList, data: string): void {
  const index = [Key.up, Key.down, Key.pageUp, Key.pageDown, Key.home, Key.end].findIndex((key) =>
    isKey(data, key),
  );
  [list.up, list.down, list.pageUp, list.pageDown, list.home, list.end][index]?.call(list);
}
export interface ModelManagerDeps {
  config: ConfigStore;
  modelsFile: {
    read(): Promise<ModelsJson>;
    update(fn: (models: ModelsJson) => ModelsJson): Promise<ModelsJson>;
  };
  initialModels: ModelsJson;
  registrar: { syncOwned(models: ModelsJson): void };
  notify: (message: string) => void;
  now: () => string;
  createKeyGroupId: () => string;
  fetch?: Fetch;
  runtimeFactory?: () => Promise<{ getModels(): unknown[] }>;
  afterProviderDelete?: (providerId: string, models: ModelsJson) => Promise<void>;
}
type Screen = "list" | "detail" | "form" | "catalog";
export class ModelManagerTab implements TabComponent {
  private readonly providerList = new ScrollList({ listRows: 7 });
  private readonly modelList = new ScrollList({ listRows: 7, multiSelect: true });
  private readonly deps: ModelManagerDeps;
  private models: ModelsJson;
  private screen: Screen = "list";
  private selectedProviderId: string | undefined;
  private form: TabComponent | undefined;
  private formBack: (() => void) | undefined;
  private catalogScreen: CatalogScreen | undefined;
  private confirm: Confirm | undefined;
  private pending: Promise<void> | undefined;
  constructor(deps: ModelManagerDeps = emptyModelManagerDeps()) {
    this.deps = deps;
    this.models = structuredClone(deps.initialModels);
    this.setProviderRows();
  }
  render(width: number, listRows: number): string[] {
    this.providerList.setListRows(listRows);
    this.modelList.setListRows(listRows);
    if (this.confirm !== undefined) return this.renderConfirm(width, listRows);
    if (this.screen === "form") return this.form?.render(width, listRows) ?? [];
    if (this.screen === "catalog") return this.catalogScreen?.render(width, listRows) ?? [];
    return this.screen === "detail" ? this.renderDetail(width) : this.renderList(width);
  }
  handleInput(data: string): void | Promise<void> {
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
    if (data === "a") this.openProviderForm();
    else if (data === "d") this.openProviderDelete();
    else if (data === "m") this.openProviderForm(PROVIDER_MODES[2]);
    else if (data === "r") this.openProviderForm(PROVIDER_MODES[1]);
    else if (data === "k") this.openKeyGroupForm();
    else if (data === "c") this.openCatalog();
    else if (isKey(data, Key.enter)) this.openSelectedProvider();
    else move(this.providerList, data);
  }
  hints(): Array<[string, string]> {
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
    const provider = this.currentProvider();
    if (provider === undefined) {
      this.screen = "list";
      this.selectedProviderId = undefined;
      return;
    }
    this.setModelRows(provider);
  }
  private currentProvider(): ProviderNode | undefined {
    const id = this.selectedProviderId;
    return id === undefined ? undefined : this.models.providers[id];
  }
  private handleDetailInput(data: string): void | Promise<void> {
    if (isKey(data, Key.escape)) {
      this.screen = "list";
      this.modelList.setRows([]);
      this.selectedProviderId = undefined;
    } else if (data === "a") this.openCatalog(this.selectedProviderId);
    else if (data === "d") this.openRemoveModels();
    else if (data === "s") this.openSyncModels();
    else if (data === "e") this.openProviderForm(PROVIDER_MODES[0]);
    else if (isKey(data, Key.space)) this.modelList.toggleMark();
    else if (isKey(data, Key.enter)) this.openModelForm();
    else move(this.modelList, data);
  }
  private setProviderRows(): void {
    this.providerList.setRows(listProviders(this.models).map(providerRow));
  }
  private setModelRows(provider: ProviderNode): void {
    const catalog = this.deps.config.get().catalog;
    this.modelList.setRows(provider.models.map((model) => modelRow(model, catalog)));
  }
  private openSelectedProvider(): void {
    const entry = listProviders(this.models)[this.providerList.selected];
    if (entry === undefined) return;
    this.selectedProviderId = entry.id;
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
    this.form = new KeyGroupForm({
      ...this.deps,
      onDone: (models) => this.finishForm(models, "list"),
    });
    this.screen = "form";
  }
  private openProviderForm(mode: "full" | "rename" | "multiplier" = "full"): void {
    const back: Screen = this.screen === "detail" ? "detail" : "list";
    const providerId =
      mode === "full"
        ? { detail: this.selectedProviderId, list: undefined }[back]
        : listProviders(this.models)[this.providerList.selected]?.id;
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
    const model = this.currentProvider()?.models[this.modelList.selected];
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
    const provider = this.currentProvider();
    if (provider !== undefined) this.setModelRows(provider);
  }
  private modelIds(indices: number[], provider: ProviderNode): string[] {
    return indices
      .map((index) => provider.models[index]?.id)
      .filter((id): id is string => id !== undefined);
  }
  private selectedModelIds(): string[] {
    const provider = this.currentProvider();
    if (provider === undefined) return [];
    const marked = this.modelIds(this.modelList.markedIndices(), provider);
    if (marked.length > 0) return marked;
    const selected = provider.models[this.modelList.selected]?.id;
    return selected === undefined ? [] : [selected];
  }
  private syncModelIds(): string[] {
    const provider = this.currentProvider();
    return provider === undefined ? [] : this.modelIds(this.modelList.markedIndices(), provider);
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
    const provider = this.currentProvider();
    if (providerId === undefined || provider === undefined || provider.models.length === 0) return;
    const ids = this.syncModelIds();
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
    const entry = listProviders(this.models)[this.providerList.selected];
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
    this.confirm = new Confirm(
      title,
      details,
      () => {
        this.confirm = undefined;
        this.start(action);
      },
      () => (this.confirm = undefined),
    );
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
  private completeModels(models: ModelsJson, screen: Screen): void {
    this.deps.registrar.syncOwned(models);
    this.finishModels(models, screen);
  }
  private finishModels(models: ModelsJson, screen: Screen): void {
    this.models = structuredClone(models);
    this.screen = screen;
    this.setProviderRows();
    const provider = screen === "detail" ? this.currentProvider() : undefined;
    if (provider === undefined) {
      this.selectedProviderId = undefined;
      this.screen = screen === "detail" ? "list" : screen;
      return;
    }
    this.setModelRows(provider);
  }
  private renderList(width: number): string[] {
    const header = truncateToWidth(S.modelManager.providerHeader, width);
    return [header, ...this.providerList.render(width)];
  }
  private renderDetail(width: number): string[] {
    const id = this.selectedProviderId;
    const provider = this.currentProvider();
    if (id === undefined || provider === undefined) {
      this.screen = "list";
      return this.renderList(width);
    }
    return [truncateToWidth(detailHeader(id, provider), width), ...this.modelList.render(width)];
  }
  private renderConfirm(width: number, listRows: number): string[] {
    const title =
      this.screen === "detail" ? S.modelManager.modelForm.title : S.modelManager.providerHeader;
    return [
      truncateToWidth(title, width),
      ...fitCatalogBody(this.confirm?.render(width) ?? [], width, listRows),
    ];
  }
}
export * from "./modelManager/forms.js";
