import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const HIGHLIGHT_START = "\x1b[7m";
const HIGHLIGHT_END = "\x1b[27m";

export interface Row {
  text: string;
  marked?: boolean;
}

export class ScrollList {
  private rows: Row[] = [];
  private top = 0;
  selected = 0;

  constructor(private opts: { listRows: number; multiSelect?: boolean }) {}

  setRows(rows: Row[]): void {
    this.rows = rows;
    this.selected = Math.min(this.selected, Math.max(0, rows.length - 1));
    this.clampTop();
  }

  setListRows(n: number): void {
    this.opts.listRows = n;
    this.clampTop();
  }

  toggleMark(): void {
    const row = this.rows[this.selected];
    if (this.opts.multiSelect && row) row.marked = !row.marked;
  }

  markedIndices(): number[] {
    return this.rows.flatMap((row, index) => (row.marked ? [index] : []));
  }

  up(): void {
    this.move(-1);
  }

  down(): void {
    this.move(1);
  }

  pageUp(): void {
    this.move(-this.opts.listRows);
  }

  pageDown(): void {
    this.move(this.opts.listRows);
  }

  home(): void {
    this.move(-Infinity);
  }

  end(): void {
    this.move(Infinity);
  }

  render(width: number): string[] {
    const listRows = this.opts.listRows;
    const overflow = this.rows.length > listRows;
    const textWidth = overflow ? width - 2 : width;
    const thumbLength = overflow
      ? Math.max(1, Math.round((listRows * listRows) / this.rows.length))
      : 0;
    const thumbTop = overflow
      ? Math.round((this.top / (this.rows.length - listRows)) * (listRows - thumbLength))
      : 0;
    const output: string[] = [];

    for (let i = 0; i < listRows; i++) {
      const row = this.rows[this.top + i];
      let text = "";
      if (row) text = `${this.markFor(row)}${row.text}`;
      text = truncateToWidth(text, textWidth);
      text += " ".repeat(Math.max(0, textWidth - visibleWidth(text)));
      if (this.top + i === this.selected && row) {
        text = `${HIGHLIGHT_START}${text}${HIGHLIGHT_END}`;
      }
      if (overflow) text += i >= thumbTop && i < thumbTop + thumbLength ? " █" : " ░";
      output.push(text);
    }

    return output;
  }

  private markFor(row: Row): string {
    if (!this.opts.multiSelect) return "";
    if (row.marked) return "[x] ";
    return "[ ] ";
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected + delta));
    this.clampTop();
  }

  private clampTop(): void {
    const listRows = this.opts.listRows;
    if (this.selected < this.top) this.top = this.selected;
    if (this.selected >= this.top + listRows) this.top = this.selected - listRows + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, this.rows.length - listRows)));
  }
}
