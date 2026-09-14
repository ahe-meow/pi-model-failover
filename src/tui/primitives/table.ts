import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface TableColumn {
  header: string;
  minWidth?: number;
}

export interface TableLayout {
  header: string;
  row(cells: string[]): string;
}

const GAP = "  ";

export const tableColumns = (headers: readonly string[] | string): TableColumn[] =>
  (typeof headers === "string" ? headers.split(/\s{2,}/) : headers).map((header) => ({ header }));

export function createTable(
  columns: readonly TableColumn[],
  rows: readonly (readonly string[])[],
  width: number,
): TableLayout {
  const natural = columns.map((column, index) =>
    Math.max(1, visibleWidth(column.header), ...rows.map((row) => visibleWidth(row[index] ?? ""))),
  );
  const minimum = columns.map((column, index) =>
    Math.min(natural[index] ?? 1, Math.max(1, column.minWidth ?? 1)),
  );
  const widths = [...natural];
  const available = Math.max(0, width - GAP.length * Math.max(0, columns.length - 1));

  while (widths.reduce((sum, value) => sum + value, 0) > available) {
    const index = widths.reduce<number | undefined>((candidate, value, current) => {
      if (value <= (minimum[current] ?? 1)) return candidate;
      if (candidate === undefined || value > (widths[candidate] ?? 0)) return current;
      return candidate;
    }, undefined);
    if (index === undefined) break;
    const currentWidth = widths[index] ?? 1;
    widths[index] = Math.max(minimum[index] ?? 1, currentWidth - 1);
  }

  const render = (cells: string[]): string => {
    const line = cells
      .map((cell, index) => {
        const limit = widths[index] ?? 1;
        const text = truncateToWidth(cell ?? "", limit);
        return index === cells.length - 1
          ? text
          : text + " ".repeat(Math.max(0, limit - visibleWidth(text)));
      })
      .join(GAP);
    return truncateToWidth(line, Math.max(0, width));
  };

  return { header: render(columns.map((column) => column.header)), row: render };
}
