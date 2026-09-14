import { Key, type KeyId, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../../../config/configStore.js";
import { addTargets, sameModelImport } from "../../../domain/chains.js";
import type { Chain, ModelsJson, Target, TargetRef } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import { MultiSelectList } from "../../primitives/multiSelectList.js";
import type { Row } from "../../primitives/scrollList.js";
import { filterRows, renderFilterDraft, TextFilter } from "../../primitives/textFilter.js";
import type { TabComponent } from "../history.js";

const E = String();
type Registrar = { syncFailover(chains: Chain[], models: ModelsJson): void };

export interface ImportPreviewOptions {
  config: ConfigStore;
  chainId: string;
  modelId?: string;
  allTargets?: boolean;
  models: () => ModelsJson;
  registrar: Registrar;
  notify?: (message: string) => void;
  onDone: () => void;
  onCancel: () => void;
}

function isKey(data: string, key: KeyId): boolean {
  return data === key || matchesKey(data, key);
}
function targetRef(target: Target): TargetRef {
  return `${target.provider}/${target.modelId}` as TargetRef;
}
function fitBody(lines: string[], width: number, rows: number): string[] {
  const body = lines.slice(0, rows).map((line) => truncateToWidth(line, width));
  while (body.length < rows) body.push(E);
  return body;
}
function appendAllTargets(chain: Chain, models: ModelsJson): Chain {
  const refs = Object.entries(models.providers)
    .filter(([provider]) => provider !== "failover")
    .flatMap(([provider, node]) =>
      node.models.map((model): TargetRef => `${provider}/${model.id}` as TargetRef),
    );
  return addTargets(chain, refs);
}

export class ImportPreview implements TabComponent {
  private readonly list: MultiSelectList;
  private readonly candidates: Array<TargetRef | undefined>;
  private readonly rows: Row[];
  private readonly filter = new TextFilter();
  private pending: Promise<void> | undefined;

  constructor(private readonly options: ImportPreviewOptions) {
    const chain = options.config.get().chains.find((candidate) => candidate.id === options.chainId);
    let imported: Chain | undefined;
    if (chain !== undefined) {
      imported = options.allTargets
        ? appendAllTargets(chain, options.models())
        : sameModelImport(chain, options.models(), options.modelId ?? E);
    }
    const existingCount = chain?.targets.length ?? 0;
    const targets = imported?.targets ?? [];
    this.candidates = targets.map((target, index) =>
      index < existingCount ? undefined : targetRef(target),
    );
    const rows = targets.map((target, index): Row => {
      const row: Row = {
        text: `${targetRef(target)}  ${index < existingCount ? S.chains.import.existing : S.chains.import.add}`,
      };
      if (index >= existingCount) row.marked = true;
      return row;
    });
    this.list = new MultiSelectList({
      listRows: 7,
      onConfirm: (indices) => {
        this.pending = this.save(indices);
      },
    });
    this.rows = rows;
    this.list.setRows(this.rows);
    this.applyFilter();
  }

  render(width: number, rows: number): string[] {
    this.list.setListRows(rows);
    if (this.filter.isEditing)
      return renderFilterDraft(width, S.filter.inputTitle, this.filter, Math.max(0, rows) + 1);
    return [
      truncateToWidth(
        this.options.allTargets
          ? S.chains.import.allTitle
          : S.chains.import.title(this.options.modelId ?? E),
        width,
      ),
      ...fitBody(this.list.render(width), width, rows),
    ];
  }

  async handleInput(data: string): Promise<void> {
    if (this.filter.isEditing) {
      if (this.filter.handleInput(data) === "applied") this.applyFilter();
      return;
    }
    if (isKey(data, Key.escape)) {
      if (this.filter.clear()) {
        this.applyFilter();
        return;
      }
      this.options.onCancel();
      return;
    }
    if (isKey(data, Key.slash)) {
      this.filter.open();
      return;
    }
    this.list.handleInput(data);
    const pending = this.pending;
    if (pending === undefined) return;
    await pending;
    if (this.pending === pending) this.pending = undefined;
  }

  isEditing(): boolean {
    return this.filter.isEditing;
  }

  hints(): Array<[string, string]> {
    return S.hints.modelManager.catalogSelect;
  }

  helpTitle(): string {
    return this.options.allTargets
      ? S.chains.import.allTitle
      : S.chains.import.title(this.options.modelId ?? E);
  }

  private applyFilter(): void {
    const filtered = filterRows(this.rows, (row) => row, this.filter.query);
    this.list.setVisibleIndices(filtered.map(({ index }) => index));
  }

  private async save(indices: number[]): Promise<void> {
    const selected = indices
      .map((index) => this.candidates[index])
      .filter((ref): ref is TargetRef => ref !== undefined);
    if (selected.length === 0) {
      this.options.onDone();
      return;
    }
    try {
      await this.options.config.update((config) => {
        const chain = config.chains.find((candidate) => candidate.id === this.options.chainId);
        if (chain === undefined) throw new Error(S.chains.import.saveFailed);
        const next = addTargets(chain, selected);
        chain.targets = next.targets;
      });
      this.options.registrar.syncFailover(
        structuredClone(this.options.config.get().chains),
        this.options.models(),
      );
      this.options.onDone();
    } catch {
      this.options.notify?.(S.chains.import.saveFailed);
    }
  }
}
