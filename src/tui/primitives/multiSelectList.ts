import { Key, type KeyId, matchesKey } from "@earendil-works/pi-tui";
import { type Row, ScrollList } from "./scrollList.js";
import type { TableColumn } from "./table.js";

export interface MultiSelectListOptions {
  listRows: number;
  columns?: readonly TableColumn[];
  onConfirm: (indices: number[]) => void;
}

function isKey(data: string, key: KeyId): boolean {
  return data === key || matchesKey(data, key);
}

export class MultiSelectList {
  private rows: Row[] = [];
  private visibleIndices: number[] = [];
  private readonly list: ScrollList;

  constructor(private readonly options: MultiSelectListOptions) {
    this.list = new ScrollList({
      listRows: options.listRows,
      multiSelect: true,
      ...(options.columns === undefined ? {} : { columns: options.columns }),
    });
  }

  get selected(): number {
    return this.list.selected;
  }

  setRows(rows: Row[]): void {
    this.rows = rows;
    this.visibleIndices = rows.map((_, index) => index);
    this.refreshList();
  }

  setVisibleIndices(indices: number[]): void {
    this.visibleIndices = indices.filter((index) => this.rows[index] !== undefined);
    this.refreshList();
  }

  setListRows(listRows: number): void {
    this.list.setListRows(listRows);
  }

  header(width: number): string {
    return this.list.header(width);
  }

  render(width: number): string[] {
    return this.list.render(width);
  }

  handleInput(data: string): void {
    if (isKey(data, "a")) {
      for (const index of this.visibleIndices) {
        const row = this.rows[index];
        if (row) row.marked = true;
      }
      this.refreshList();
      return;
    }
    if (isKey(data, "n")) {
      for (const index of this.visibleIndices) {
        const row = this.rows[index];
        if (row) row.marked = false;
      }
      this.refreshList();
      return;
    }
    if (isKey(data, Key.enter)) {
      if (this.visibleIndices.length === 0) return;
      this.options.onConfirm(this.markedIndices());
      return;
    }
    if (isKey(data, Key.up)) this.list.up();
    else if (isKey(data, Key.down)) this.list.down();
    else if (isKey(data, Key.pageUp)) this.list.pageUp();
    else if (isKey(data, Key.pageDown)) this.list.pageDown();
    else if (isKey(data, Key.home)) this.list.home();
    else if (isKey(data, Key.end)) this.list.end();
    else if (isKey(data, Key.space)) this.list.toggleMark();
  }

  markedIndices(): number[] {
    return this.rows.flatMap((row, index) => (row.marked ? [index] : []));
  }

  private refreshList(): void {
    this.list.setRows(
      this.visibleIndices.flatMap((index) => {
        const row = this.rows[index];
        return row === undefined ? [] : [row];
      }),
    );
  }
}
