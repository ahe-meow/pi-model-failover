import { Key, truncateToWidth } from "@earendil-works/pi-tui";
import * as ops from "../../domain/chains.js";
import { reset } from "../../domain/cooldown.js";
import type { Chain, ModelsJson, Target, TargetRef, TargetState } from "../../domain/types.js";
import { S } from "../../strings.js";
import { selectChain } from "../modelSelection.js";
import { Confirm } from "../primitives/confirm.js";
import type { Form } from "../primitives/form.js";
import { ScrollList } from "../primitives/scrollList.js";
import { tableColumns } from "../primitives/table.js";
import { activeTextFilter, draft, TextFilter } from "../primitives/textFilter.js";
import { theme } from "../primitives/theme.js";
import { ImportPreview } from "./chains/importPreview.js";
import * as rows from "./chains/rows.js";
import { createChainForm, fitBody, isKey, manualEvent, move, targetRef } from "./chains/support.js";
import { TargetForm } from "./chains/targetForm.js";
import { type ChainsDeps, emptyChainsDeps } from "./chains/types.js";
import type { TabComponent } from "./history.js";

export type { ChainsDeps } from "./chains/types.js";

type Screen = "list" | "detail" | "form";
type FormMode = "new" | "rename";
const RENAME_MODE: FormMode = "rename";
const renderPanel = (title: string, body: string[], width: number, listRows: number): string[] => [
  theme.title(truncateToWidth(title, width)),
  ...fitBody(body, width, listRows),
];
export class ChainsTab implements TabComponent {
  private readonly chainList = new ScrollList({
    listRows: 7,
    columns: tableColumns(S.chains.listHeader),
  });
  private readonly targetList = new ScrollList({
    listRows: 7,
    columns: rows.targetColumns(),
  });
  private states: Record<TargetRef, TargetState> = {};
  private screen: Screen = "list";
  private selectedChainId: string | undefined;
  private form: Form | undefined;
  private subScreen: TabComponent | undefined;
  private formTitle = "";
  private confirm: Confirm | undefined;
  private pending: Promise<void> | undefined;
  private readonly chainFilter = new TextFilter();
  private readonly targetFilter = new TextFilter();
  private visibleChains: Chain[] = [];
  private visibleTargetIndices: number[] = [];
  private sortDescending = false;
  constructor(private readonly deps: ChainsDeps = emptyChainsDeps()) {
    this.setChainRows();
    void this.refreshState().catch(() => {});
  }
  render(width: number, listRows: number): string[] {
    this.chainList.setListRows(listRows);
    this.targetList.setListRows(listRows);
    const filter = this.activeFilter();
    if (filter?.isEditing) return draft(width, filter, listRows, this.screen === "detail");
    if (this.subScreen !== undefined) return this.subScreen.render(width, listRows);
    if (this.confirm !== undefined)
      return renderPanel(S.chains.listHeader, this.confirm.render(width), width, listRows);
    if (this.form !== undefined)
      return renderPanel(this.formTitle, this.form.render(width), width, listRows);
    return this.screen === "detail" ? this.renderDetail(width, listRows) : this.renderList(width);
  }
  async handleInput(data: string): Promise<void> {
    if (this.subScreen !== undefined) return this.subScreen.handleInput(data);
    if (this.confirm !== undefined) {
      this.confirm.handleInput(data);
      await this.waitForPending();
      return;
    }
    if (this.form !== undefined) {
      this.form.handleInput(data);
      await this.waitForPending();
      return;
    }
    const filter = this.activeFilter();
    if (filter?.isEditing) {
      if (filter.handleInput(data) === "applied") this.refreshFilteredRows();
      return;
    }
    if (this.screen === "detail") return this.handleDetailInput(data);
    if (isKey(data, Key.slash)) this.chainFilter.open();
    else if (isKey(data, Key.escape) && this.chainFilter.clear()) this.refreshFilteredRows();
    else if (data === "a") {
      this.openChainForm("new");
    } else if (data === "d") this.openDelete();
    else if (data === "r") this.openResetChain();
    else if (data === "n") this.openChainForm(RENAME_MODE);
    else if (data === "R") this.openResetChain();
    else if (data === "p") return selectChain(this.deps.useModel, this.selectedListChain()?.id);
    else if (isKey(data, Key.enter)) this.openSelectedChain();
    else move(this.chainList, data);
  }
  // biome-ignore format: keep the editing predicate compact
  isEditing = (): boolean => Boolean(this.activeFilter()?.isEditing || this.form?.isEditing() || this.subScreen?.isEditing?.());
  hints(): Array<[string, string]> {
    if (this.subScreen !== undefined) return this.subScreen.hints();
    if (this.confirm !== undefined) return S.hints.confirm;
    if (this.form !== undefined) return S.hints.form;
    return this.screen === "detail" ? S.hints.chains.detail : S.hints.chains.list;
  }
  helpTitle(): string {
    return S.tabs[1];
  }
  private renderList(width: number): string[] {
    this.setChainRows();
    return [this.chainList.header(width), ...this.chainList.render(width)];
  }
  private renderDetail(width: number, listRows: number): string[] {
    const chain = this.currentChain();
    if (chain === undefined) {
      this.screen = "list";
      this.selectedChainId = undefined;
      return this.renderList(width);
    }
    const models = this.deps.models();
    this.targetList.setListRows(Math.max(0, listRows - 1));
    this.setTargetRows(chain, models);
    return [
      theme.title(truncateToWidth(rows.chainDetailHeader(chain, models), width)),
      this.targetList.header(width),
      ...this.targetList.render(width),
    ];
  }
  private async handleDetailInput(data: string): Promise<void> {
    const chain = this.currentChain();
    if (chain === undefined) return;
    if (isKey(data, Key.escape)) {
      if (this.targetFilter.clear()) {
        this.refreshFilteredRows();
        return;
      }
      this.screen = "list";
      this.selectedChainId = undefined;
    } else if (isKey(data, Key.slash)) this.targetFilter.open();
    else if (isKey(data, Key.enter)) this.openTargetForm();
    else if (data === "a") this.openTargetPicker(true);
    else if (data === "i") this.openTargetPicker(false);
    else if (data === "d") this.openRemoveTarget();
    else if (data === "r") this.openResetTarget();
    else if (data === "p") return selectChain(this.deps.useModel, chain.id);
    else if (data === "s") await this.sortTargets();
    else if (data.toLowerCase() === "j") await this.moveSelectedTarget(1);
    else if (isKey(data, Key.shift("j"))) await this.moveSelectedTarget(1);
    else if (data.toLowerCase() === "k") await this.moveSelectedTarget(-1);
    else if (isKey(data, Key.shift("k"))) await this.moveSelectedTarget(-1);
    else move(this.targetList, data);
  }
  private activeFilter(): TextFilter | undefined {
    return activeTextFilter(this.screen, this.chainFilter, this.targetFilter);
  }
  private refreshFilteredRows(): void {
    const chain = this.currentChain();
    if (this.screen === "list") this.setChainRows();
    else if (chain !== undefined) this.setTargetRows(chain, this.deps.models());
  }
  private setChainRows(): void {
    const chains = this.deps.config.get().chains;
    const result = rows.filteredChainRows(
      chains,
      this.states,
      Date.parse(this.deps.now()) || 0,
      this.chainFilter.query,
    );
    this.chainList.setRows(result.rows);
    this.visibleChains = result.chains;
  }
  private setTargetRows(chain: Chain, models: ModelsJson): void {
    const result = rows.filteredTargetRows(
      chain,
      models,
      this.states,
      Date.parse(this.deps.now()) || 0,
      this.targetFilter.query,
    );
    this.visibleTargetIndices = result.indices;
    this.targetList.setRows(result.rows);
  }
  private currentChain(): Chain | undefined {
    return this.deps.config.get().chains.find((chain) => chain.id === this.selectedChainId);
  }
  private selectedListChain = (): Chain | undefined => this.visibleChains[this.chainList.selected];
  private openSelectedChain(): void {
    const chain = this.selectedListChain();
    if (chain === undefined) return;
    this.selectedChainId = chain.id;
    this.sortDescending = false;
    this.targetList.selected = 0;
    this.targetFilter.reset();
    this.visibleTargetIndices = chain.targets.map((_, index) => index);
    this.screen = "detail";
    void this.refreshState().catch(() => {});
  }
  private openTargetForm(): void {
    const chain = this.currentChain();
    const targetIndex = this.visibleTargetIndices[this.targetList.selected];
    if (!chain || targetIndex === undefined || !chain.targets[targetIndex]) return;
    this.subScreen = new TargetForm({
      ...this.deps,
      chainId: chain.id,
      targetIndex,
      onDone: () => this.closeSubScreen(),
      onCancel: () => this.closeSubScreen(),
    });
  }
  private openTargetPicker(allTargets: boolean): void {
    const chain = this.currentChain();
    if (chain === undefined) return;
    const targetIndex = this.visibleTargetIndices[this.targetList.selected];
    const target = targetIndex === undefined ? undefined : chain.targets[targetIndex];
    const modelId = target?.modelId ?? this.deps.config.get().catalog[0]?.id ?? String();
    this.subScreen = new ImportPreview({
      ...this.deps,
      chainId: chain.id,
      modelId,
      allTargets,
      onDone: () => this.closeSubScreen(),
      onCancel: () => this.closeSubScreen(),
    });
  }
  private openRemoveTarget(): void {
    const chain = this.currentChain();
    const position = this.targetList.selected;
    const index = this.visibleTargetIndices[position];
    const target = index === undefined ? undefined : chain?.targets[index];
    if (chain === undefined || index === undefined || target === undefined) return;
    const ref = targetRef(target);
    this.ask(
      S.chains.actions.removeTargetTitle(ref),
      [S.chains.actions.removeTargetDetails],
      async () => {
        await this.updateChains((chains) =>
          chains.map((entry) => (entry.id === chain.id ? ops.removeTarget(entry, ref) : entry)),
        );
        this.targetList.selected = Math.min(position, Math.max(0, chain.targets.length - 2));
      },
    );
  }
  private closeSubScreen(): void {
    this.subScreen = undefined;
  }
  private openChainForm(mode: FormMode): void {
    const current = mode === "rename" ? this.selectedListChain() : undefined;
    if (mode === "rename" && current === undefined) return;
    this.formTitle = mode === "new" ? S.chains.form.newTitle : S.chains.form.renameTitle;
    this.form = createChainForm(
      mode,
      current,
      this.deps.createChainId,
      (values) => this.start(() => this.saveChain(mode, values)),
      () => this.closeForm("list"),
    );
  }

  private async saveChain(mode: FormMode, values: Record<string, unknown>): Promise<void> {
    const current = mode === "rename" ? this.selectedListChain() : undefined;
    const id = String(values.id ?? String()).trim();
    const name = String(values.name ?? "").trim();
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
      this.deps.notify(S.chains.form.invalidId);
      return;
    }
    if (
      this.deps.config.get().chains.some((chain) => chain.id === id && chain.id !== current?.id)
    ) {
      this.deps.notify(S.chains.form.duplicateId);
      return;
    }
    if (name === "") {
      this.deps.notify(S.chains.form.invalidName);
      return;
    }
    await this.updateChains((chains) =>
      mode === "rename" && current !== undefined
        ? ops.renameChain(chains, current.id, id, name)
        : ops.upsertChain(chains, { id, name, targets: [] }),
    );
    if (this.selectedChainId === current?.id) this.selectedChainId = id;
    this.closeForm("list");
    this.setChainRows();
    this.chainList.selected = Math.max(
      0,
      this.visibleChains.findIndex((chain) => chain.id === id),
    );
  }
  private openDelete(): void {
    const chain = this.selectedListChain();
    if (chain === undefined) return;
    this.ask(S.chains.actions.deleteTitle(chain.id), [S.chains.actions.deleteDetails], async () => {
      await this.updateChains((chains) => ops.removeChain(chains, chain.id));
      this.selectedChainId = undefined;
    });
  }
  private openResetChain(): void {
    const chain = this.screen === "detail" ? this.currentChain() : this.selectedListChain();
    if (chain === undefined) return;
    const targets = structuredClone(chain.targets);
    this.ask(
      S.chains.actions.resetTitle(chain.id, targets.length),
      [S.chains.actions.resetDetails],
      () => this.resetTargets(targets),
    );
  }
  private openResetTarget(): void {
    const target =
      this.currentChain()?.targets[this.visibleTargetIndices[this.targetList.selected] ?? -1];
    if (target !== undefined) this.start(() => this.resetTargets([target]));
  }
  private async resetTargets(targets: Target[]): Promise<void> {
    const timestamp = this.deps.now();
    const refs = targets.map(targetRef);
    await this.deps.state.update((states) => {
      for (const ref of refs) states[ref] = reset();
    });
    for (const ref of refs)
      await this.deps.history.append(manualEvent(ref, timestamp, this.deps.sessionId));
    await this.refreshState();
  }
  private async sortTargets(): Promise<void> {
    const chain = this.currentChain();
    if (chain === undefined || chain.targets.length < 2) return;
    const index = this.visibleTargetIndices[this.targetList.selected];
    const selectedTarget = index === undefined ? undefined : chain.targets[index];
    const selectedRef = selectedTarget === undefined ? undefined : targetRef(selectedTarget);
    const models = this.deps.models();
    const direction = this.sortDescending ? "desc" : "asc";
    await this.updateChains((chains) =>
      chains.map((entry) =>
        entry.id === chain.id
          ? { ...entry, targets: ops.sortTargetsByCostMultiplier(entry.targets, models, direction) }
          : entry,
      ),
    );
    this.sortDescending = !this.sortDescending;
    const updated = this.currentChain();
    if (updated === undefined) return;
    this.setTargetRows(updated, models);
    const targetIndex = updated.targets.findIndex((target) => targetRef(target) === selectedRef);
    this.targetList.selected = Math.max(0, this.visibleTargetIndices.indexOf(targetIndex));
  }
  private async moveSelectedTarget(delta: -1 | 1): Promise<void> {
    const chain = this.currentChain();
    const position = this.targetList.selected;
    const index = this.visibleTargetIndices[position];
    if (chain === undefined || index === undefined) return;
    if (index + delta < 0 || index + delta >= chain.targets.length) return;
    await this.updateChains((chains) =>
      chains.map((entry) => (entry.id === chain.id ? ops.moveTarget(entry, index, delta) : entry)),
    );
    const updated = this.currentChain();
    if (updated !== undefined) {
      this.setTargetRows(updated, this.deps.models());
      const nextPosition = this.visibleTargetIndices.indexOf(index + delta);
      this.targetList.selected =
        nextPosition >= 0
          ? nextPosition
          : Math.min(position, Math.max(0, updated.targets.length - 1));
    }
  }

  private async updateChains(transform: (chains: Chain[]) => Chain[]): Promise<void> {
    await this.deps.config.update((config) => (config.chains = transform(config.chains)));
    const chains = structuredClone(this.deps.config.get().chains);
    this.deps.registrar.syncFailover(chains, this.deps.models());
  }

  private ask(title: string, details: string[], action: () => Promise<void>): void {
    this.confirm = new Confirm(
      title,
      details,
      () => {
        this.confirm = undefined;
        this.start(action);
      },
      () => {
        this.confirm = undefined;
      },
    );
  }
  private start(task: () => Promise<void>): void {
    this.pending = task().catch(() => this.deps.notify(S.chains.form.saveFailed));
  }
  private async refreshState(): Promise<void> {
    this.states = await this.deps.state.read();
  }
  private closeForm(screen: Screen): void {
    this.form = undefined;
    this.formTitle = "";
    this.screen = screen;
  }

  private async waitForPending(): Promise<void> {
    const operation = this.pending;
    if (operation !== undefined) await operation;
    if (this.pending === operation) this.pending = undefined;
  }
}
