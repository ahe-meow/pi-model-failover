import {
  decodeKittyPrintable,
  Key,
  type KeyId,
  matchesKey,
  stripTerminalSequences,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { S } from "../../strings.js";
import type { Row } from "./scrollList.js";
import { theme } from "./theme.js";

export type FilterInputResult = "ignored" | "changed" | "applied" | "cancelled";

function isKey(data: string, key: KeyId): boolean {
  return data === key || matchesKey(data, key);
}

export class TextFilter {
  private applied = "";
  private draft: string | undefined;

  get query(): string {
    return this.applied;
  }

  get draftValue(): string | undefined {
    return this.draft;
  }

  get isEditing(): boolean {
    return this.draft !== undefined;
  }

  open(): void {
    this.draft = this.applied;
  }

  reset(): void {
    this.applied = "";
    this.draft = undefined;
  }

  clear(): boolean {
    if (this.applied === "") return false;
    this.applied = "";
    return true;
  }

  handleInput(data: string): FilterInputResult {
    const draft = this.draft;
    if (draft === undefined) return "ignored";
    if (isKey(data, Key.escape)) {
      this.draft = undefined;
      return "cancelled";
    }
    if (isKey(data, Key.enter)) {
      this.applied = draft.trim();
      this.draft = undefined;
      return "applied";
    }
    if (isKey(data, Key.backspace)) {
      this.draft = draft.slice(0, -1);
      return "changed";
    }
    const printable = decodeKittyPrintable(data);
    if (printable !== undefined || (data.length === 1 && !data.startsWith("\x1b"))) {
      this.draft = draft + (printable ?? data);
      return "changed";
    }
    return "ignored";
  }
}

export function rowMatches(row: Row, query: string): boolean {
  const normalized = query.toLowerCase();
  const cells = row.cells ?? [row.text];
  return (
    normalized === "" ||
    [...cells, row.text].some((cell) =>
      stripTerminalSequences(cell).toLowerCase().includes(normalized),
    )
  );
}

export function filterRows<T>(
  items: readonly T[],
  toRow: (item: T, index: number) => Row,
  query: string,
): Array<{ item: T; row: Row; index: number }> {
  return items.flatMap((item, index) => {
    const row = toRow(item, index);
    return rowMatches(row, query) ? [{ item, row, index }] : [];
  });
}

export function filterBodyLines(listRows: number, detail: boolean): number {
  return detail ? 2 + Math.max(0, listRows - 1) : 1 + Math.max(0, listRows);
}

export function activeTextFilter(
  screen: string,
  list: TextFilter,
  detail: TextFilter,
): TextFilter | undefined {
  if (screen === "list") return list;
  if (screen === "detail") return detail;
  return undefined;
}

export function draft(
  width: number,
  filter: TextFilter,
  listRows: number,
  detail: boolean,
): string[] {
  return renderFilterDraft(width, S.filter.inputTitle, filter, filterBodyLines(listRows, detail));
}

export function renderFilterDraft(
  width: number,
  title: string,
  filter: TextFilter,
  bodyLines: number,
): string[] {
  const draft = filter.draftValue ?? String();
  const lines = [
    truncateToWidth(theme.title(title), width),
    truncateToWidth(theme.current(`${S.form.inputPrompt}: ${draft}${S.form.cursor}`), width),
    truncateToWidth(theme.muted(S.filter.inputHint), width),
  ].slice(0, Math.max(0, bodyLines));
  while (lines.length < bodyLines) lines.push(String());
  return lines;
}
