import { Key, type KeyId, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../../config/configStore.js";
import type { SharedState } from "../../config/sharedState.js";
import { reset } from "../../domain/cooldown.js";
import type { Chain, FailoverEvent, TargetRef } from "../../domain/types.js";
import type { HistoryLog } from "../../history/historyLog.js";
import { S } from "../../strings.js";
import { ScrollList } from "../primitives/scrollList.js";
import { manualEvent, move, targetRef } from "./chains/support.js";

export interface TabComponent {
  render(width: number, listRows: number): string[];
  handleInput(data: string): void | Promise<void>;
  isEditing?(): boolean;
  hints(): Array<[string, string]>;
  helpTitle(): string;
}

export interface HistoryDeps {
  config: Pick<ConfigStore, "get">;
  history: Pick<HistoryLog, "append" | "list">;
  state: Pick<SharedState, "update">;
  now: () => string;
  sessionId: string;
  notify: (message: string) => void;
}

type Filter =
  | { kind: "none" }
  | { kind: "chain"; value: string }
  | { kind: "provider"; value: string };
type PickerKind = "chain" | "provider";

function isKey(data: string, key: KeyId): boolean {
  return data === key || matchesKey(data, key);
}

function providerOf(ref: TargetRef): string {
  return ref.slice(0, ref.indexOf("/"));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function displayTime(ts: string, now: string): string {
  const date = new Date(ts);
  const current = new Date(now);
  if (!Number.isFinite(date.getTime())) return S.history.unknownTime;
  if (Number.isFinite(current.getTime()) && sameDay(date, current)) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function targetFor(chain: Chain, ref: TargetRef): boolean {
  return chain.targets.some((target) => targetRef(target) === ref);
}

export class HistoryTab implements TabComponent {
  private readonly list = new ScrollList({ listRows: 7 });
  private readonly picker = new ScrollList({ listRows: 7 });
  private readonly detail = new ScrollList({ listRows: 7 });
  private events: FailoverEvent[] = [];
  private dropped = 0;
  private filter: Filter = { kind: "none" };
  private pickerKind: PickerKind | undefined;
  private pickerValues: string[] = [];
  private detailOpen = false;

  constructor(private readonly deps: HistoryDeps) {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const filter = this.filter;
      const provider = filter.kind === "provider" ? filter.value : undefined;
      const result = await this.deps.history.list(
        provider === undefined ? undefined : { provider },
      );
      this.events =
        filter.kind === "chain"
          ? result.events.filter((event) => this.eventChainId(event) === filter.value)
          : result.events;
      this.dropped = result.dropped;
    } catch {
      this.deps.notify(S.history.refreshFailed);
    }
  }

  render(width: number, listRows: number): string[] {
    this.list.setListRows(listRows);
    this.picker.setListRows(listRows);
    this.detail.setListRows(listRows);
    if (this.pickerKind !== undefined) return this.renderPicker(width);
    if (this.detailOpen) return this.renderDetail(width);
    return this.renderList(width);
  }

  async handleInput(data: string): Promise<void> {
    if (this.pickerKind !== undefined) {
      await this.handlePicker(data);
      return;
    }
    if (this.detailOpen) {
      if (isKey(data, Key.escape)) this.detailOpen = false;
      else if (data === "r") await this.resetSelected();
      else move(this.detail, data);
      return;
    }
    if (data === "f") {
      await this.openPicker("chain");
    } else if (data === "p") {
      await this.openPicker("provider");
    } else if (data === "c") await this.clearFilter();
    else if (data === "g") await this.refresh();
    else if (data === "r") await this.resetSelected();
    else if (isKey(data, Key.enter)) this.openDetail();
    else move(this.list, data);
  }

  hints(): Array<[string, string]> {
    if (this.pickerKind !== undefined) return S.hints.history.filter;
    if (this.detailOpen) return S.hints.history.detail;
    return S.hints.history.list;
  }

  helpTitle(): string {
    return S.tabs[2];
  }

  private renderList(width: number): string[] {
    this.list.setRows(
      this.events.map((event) => ({
        text: S.history.row(
          displayTime(event.ts, this.deps.now()),
          this.eventChain(event),
          event.from,
          event.to ?? S.history.none,
          event.reason === "manual" ? S.history.reset : event.reason,
          event.elapsedMs,
        ),
      })),
    );
    const header = this.dropped === 0 ? S.history.header : S.history.headerDropped(this.dropped);
    return [truncateToWidth(header, width), ...this.list.render(width)];
  }

  private renderPicker(width: number): string[] {
    const kind = this.pickerKind;
    if (kind === undefined) return [];
    return [truncateToWidth(S.history.filter.title(kind), width), ...this.picker.render(width)];
  }

  private renderDetail(width: number): string[] {
    const event = this.selectedEvent();
    if (event === undefined) return [];
    return [truncateToWidth(S.history.detailHeader, width), ...this.detail.render(width)];
  }

  private async openPicker(kind: PickerKind): Promise<void> {
    try {
      this.pickerKind = kind;
      this.pickerValues = kind === "chain" ? this.chainOptions() : await this.providerOptions();
      this.picker.setRows(
        this.pickerValues.map((value) => ({
          text: kind === "chain" ? this.chainLabel(value) : value,
        })),
      );
    } catch {
      this.pickerKind = undefined;
      this.deps.notify(S.history.refreshFailed);
    }
  }

  private async handlePicker(data: string): Promise<void> {
    if (isKey(data, Key.escape)) {
      this.pickerKind = undefined;
      return;
    }
    if (data === "c") {
      await this.clearFilter();
      this.pickerKind = undefined;
      return;
    }
    if (!isKey(data, Key.enter)) {
      move(this.picker, data);
      return;
    }
    const value = this.pickerValues[this.picker.selected];
    const kind = this.pickerKind;
    if (value === undefined || kind === undefined) return;
    this.filter = { kind, value };
    this.pickerKind = undefined;
    await this.refresh();
  }

  private async clearFilter(): Promise<void> {
    this.filter = { kind: "none" };
    await this.refresh();
  }

  private openDetail(): void {
    const event = this.selectedEvent();
    if (event === undefined) return;
    this.detail.setRows(
      JSON.stringify(event, null, 2)
        .split("\n")
        .map((text) => ({ text })),
    );
    this.detail.selected = 0;
    this.detailOpen = true;
  }

  private async resetSelected(): Promise<void> {
    const event = this.selectedEvent();
    if (event === undefined) return;
    try {
      await this.deps.state.update((targets) => {
        targets[event.from] = reset();
      });
      await this.deps.history.append(manualEvent(event.from, this.deps.now(), this.deps.sessionId));
      await this.refresh();
      this.list.selected = 0;
    } catch {
      this.deps.notify(S.history.resetFailed);
    }
  }

  private selectedEvent(): FailoverEvent | undefined {
    return this.events[this.list.selected];
  }

  private eventChain(event: FailoverEvent): string {
    return this.chainFor(event)?.name ?? S.history.none;
  }

  private eventChainId(event: FailoverEvent): string | undefined {
    return this.chainFor(event)?.id;
  }

  private chainFor(event: FailoverEvent): Chain | undefined {
    return this.deps.config.get().chains.find((chain) => targetFor(chain, event.from));
  }

  private chainOptions(): string[] {
    return this.deps.config.get().chains.map((chain) => chain.id);
  }

  private chainLabel(id: string): string {
    const chain = this.deps.config.get().chains.find((entry) => entry.id === id);
    return chain === undefined ? id : `${chain.name} (${chain.id})`;
  }

  private async providerOptions(): Promise<string[]> {
    const { events } = await this.deps.history.list();
    return [
      ...new Set(
        events.flatMap((event) => [
          providerOf(event.from),
          ...(event.to ? [providerOf(event.to)] : []),
        ]),
      ),
    ].sort();
  }
}
