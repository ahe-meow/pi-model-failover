import { Key, type KeyId, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { redactSecret } from "../../domain/redact.js";
import { S } from "../../strings.js";
import { theme } from "./theme.js";

export type Field =
  | {
      kind: "text";
      key: string;
      label: string;
      value: string;
      secret?: boolean;
      multiline?: boolean;
    }
  | {
      kind: "number";
      key: string;
      label: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      kind: "select";
      key: string;
      label: string;
      value: string;
      options: string[];
      warning?: Partial<Record<string, string>>;
    }
  | { kind: "multiselect"; key: string; label: string; value: string[]; options: string[] };

const HIGHLIGHT_START = "\x1b[7m";
const HIGHLIGHT_END = "\x1b[27m";

function isKey(data: string, key: KeyId): boolean {
  return data === key || matchesKey(data, key);
}

function copyValue(value: Field["value"]): Field["value"] {
  return Array.isArray(value) ? [...value] : value;
}

function isChoice(field: Field): field is Extract<Field, { kind: "select" | "multiselect" }> {
  return ["select", "multiselect"].includes(field.kind);
}

function cursorValue(value: string, cursor: number, width: number): string {
  const position = Math.max(0, Math.min(value.length, cursor));
  if (value.length + 1 <= width)
    return `${value.slice(0, position)}${S.form.cursor}${value.slice(position)}`;
  let left = Math.min(position, Math.max(0, width - 1));
  let right = Math.min(value.length - position, Math.max(0, width - 1 - left));
  while (true) {
    const start = position - left;
    const end = position + right;
    const prefix = start > 0 ? "…" : "";
    const suffix = end < value.length ? "…" : "";
    const available = Math.max(0, width - 1 - prefix.length - suffix.length);
    if (left + right <= available || (left === 0 && right === 0)) {
      return `${prefix}${value.slice(start, position)}${S.form.cursor}${value.slice(position, end)}${suffix}`;
    }
    if (right >= left && right > 0) right--;
    else if (left > 0) left--;
  }
}

export class Form {
  focus = 0;
  private cursor = 0;
  private editing = false;
  private draftValue: Field["value"] | undefined;
  private draftText: string | undefined;
  private directEdit = false;

  constructor(
    private fields: Field[],
    private onSubmit: (values: Record<string, unknown>) => void,
    private onCancel: () => void,
  ) {}

  values(): Record<string, unknown> {
    return Object.fromEntries(this.fields.map((field) => [field.key, field.value]));
  }

  isEditing(): boolean {
    return this.editing;
  }

  render(width: number): string[] {
    if (this.editing) return this.renderEditor(width);

    const out: string[] = [];
    this.fields.forEach((field, index) => {
      const label = field.label.padEnd(26);
      const line = truncateToWidth(`${label}${this.renderValue(field)}`, width);
      out.push(index === this.focus ? this.highlight(line, width) : line);
      const warning = field.kind === "select" ? field.warning?.[field.value] : undefined;
      if (warning) out.push(truncateToWidth(theme.warning(`⚠ ${warning}`), width));
    });
    return out;
  }

  handleInput(data: string): void {
    if (this.editing) {
      this.handleEditorInput(data);
      return;
    }
    const field = this.fields[this.focus];
    if (!field) return;
    if (field.kind === "text" && field.multiline && /^[\r\n]$/.test(data)) {
      field.value += "\n";
      this.directEdit = true;
      return;
    }
    if (this.handleNavigation(data)) return;
    this.handleFieldInput(field, data);
  }

  private handleFieldInput(field: Field, data: string): void {
    if (field.kind === "number") {
      field.value = this.handleNumberInput(field, field.value, data);
      this.directEdit = true;
    } else if (field.kind === "text") {
      field.value = this.handleTextInput(field, field.value, data);
      this.directEdit = true;
    }
  }

  private renderValue(field: Field): string {
    switch (field.kind) {
      case "text":
        return field.secret ? redactSecret(field.value) : field.value;
      case "number":
        return String(field.value);
      case "select":
        return this.renderOptions(field.options, field.value);
      case "multiselect":
        return this.renderOptions(field.options, field.value);
      default:
        return "";
    }
  }

  private renderOptions(options: string[], selected: string | string[]): string {
    return options
      .map((option) => {
        const checked = Array.isArray(selected) ? selected.includes(option) : selected === option;
        return `[${checked ? "x" : " "}] ${option}`;
      })
      .join("  ");
  }

  private renderEditor(width: number): string[] {
    const field = this.fields[this.focus];
    if (!field) return [];
    const lines = [truncateToWidth(theme.title(S.form.inputTitle(field.label)), width)];
    if (isChoice(field)) {
      const draft = Array.isArray(this.draftValue) ? this.draftValue : [];
      lines.push(
        ...field.options.map((option, index) => {
          const selected =
            field.kind === "select"
              ? option === (field.options[this.cursor] ?? field.value)
              : draft.includes(option);
          const line = `[${selected ? "x" : " "}] ${option}`;
          return index === this.cursor ? this.highlight(line, width) : truncateToWidth(line, width);
        }),
      );
      const warning =
        field.kind === "select"
          ? field.warning?.[field.options[this.cursor] ?? field.value]
          : undefined;
      if (warning) lines.push(truncateToWidth(theme.warning(`⚠ ${warning}`), width));
    } else {
      const value = this.draftText ?? String(field.value);
      const prompt = `${S.form.inputPrompt}: `;
      const display =
        field.kind === "text" && field.secret
          ? `${redactSecret(value)}${S.form.cursor}`
          : cursorValue(value, this.cursor, Math.max(1, width - visibleWidth(prompt)));
      lines.push(truncateToWidth(theme.current(`${prompt}${display}`), width));
    }
    lines.push(truncateToWidth(theme.muted(S.form.inputHint), width));
    return lines;
  }

  private highlight(line: string, width: number): string {
    const text = truncateToWidth(line, width);
    return `${HIGHLIGHT_START}${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}${HIGHLIGHT_END}`;
  }

  private handleNavigation(data: string): boolean {
    if (isKey(data, Key.escape)) {
      this.directEdit = false;
      this.onCancel();
      return true;
    }
    if (isKey(data, Key.tab) || isKey(data, Key.down)) {
      this.directEdit = false;
      this.focus = (this.focus + 1) % this.fields.length;
      return true;
    }
    if (isKey(data, Key.shift("tab")) || isKey(data, Key.up)) {
      this.directEdit = false;
      this.focus = (this.focus - 1 + this.fields.length) % this.fields.length;
      return true;
    }
    if (isKey(data, Key.enter)) {
      if (this.directEdit && this.focus === this.fields.length - 1) {
        this.directEdit = false;
        this.onSubmit(this.values());
      } else {
        this.beginEditing();
      }
      return true;
    }
    return false;
  }

  private beginEditing(): void {
    const field = this.fields[this.focus];
    if (!field) return;
    this.editing = true;
    this.directEdit = false;
    this.draftValue = copyValue(field.value);
    if (["text", "number"].includes(field.kind)) {
      this.draftText = String(field.value);
      this.cursor = this.draftText.length;
    } else if (field.kind === "select") {
      this.cursor = Math.max(0, field.options.indexOf(field.value));
    } else if (field.kind === "multiselect") {
      this.cursor = 0;
    }
  }

  private handleEditorInput(data: string): void {
    const field = this.fields[this.focus];
    if (!field) return;
    if (isKey(data, Key.escape)) {
      this.editing = false;
      this.draftValue = undefined;
      this.draftText = undefined;
      this.directEdit = false;
      return;
    }
    if (isKey(data, Key.enter)) {
      if (field.kind === "select") {
        field.value = field.options[this.cursor] ?? field.value;
      } else if (field.kind === "number") {
        const value = Number(this.draftText ?? field.value);
        if (Number.isFinite(value)) field.value = this.clamp(field, value);
      } else if (field.kind === "text") {
        field.value = this.draftText ?? field.value;
      } else if (this.draftValue !== undefined) {
        field.value = copyValue(this.draftValue) as never;
      }
      this.editing = false;
      this.draftValue = undefined;
      this.draftText = undefined;
      this.directEdit = false;
      if (this.focus === this.fields.length - 1) this.onSubmit(this.values());
      return;
    }
    if (field.kind === "select") {
      this.moveCursor(field.options.length, data);
      return;
    }
    if (field.kind === "multiselect") {
      this.moveCursor(field.options.length, data);
      if (isKey(data, Key.space)) this.toggle(field);
      return;
    }
    this.handleEditableInput(field, data);
  }

  private handleEditableInput(
    field: Extract<Field, { kind: "text" | "number" }>,
    data: string,
  ): void {
    const value = this.draftText ?? String(field.value);
    if (isKey(data, Key.left)) {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }
    if (isKey(data, Key.right)) {
      this.cursor = Math.min(value.length, this.cursor + 1);
      return;
    }
    if (isKey(data, Key.home)) {
      this.cursor = 0;
      return;
    }
    if (isKey(data, Key.end)) {
      this.cursor = value.length;
      return;
    }
    if (isKey(data, Key.backspace)) {
      if (this.cursor > 0) {
        this.draftText = `${value.slice(0, this.cursor - 1)}${value.slice(this.cursor)}`;
        this.cursor--;
      }
      return;
    }
    if (isKey(data, Key.delete)) {
      this.draftText = `${value.slice(0, this.cursor)}${value.slice(this.cursor + 1)}`;
      return;
    }
    if (field.kind === "number" && !/^[0-9]$/.test(data)) return;
    const insert =
      field.kind === "text" && field.multiline && /^[\r\n]$/.test(data)
        ? "\n"
        : data.length >= 1 && !data.startsWith("\x1b")
          ? data
          : "";
    if (insert === "") return;
    this.draftText = `${value.slice(0, this.cursor)}${insert}${value.slice(this.cursor)}`;
    this.cursor += insert.length;
  }

  private moveCursor(length: number, data: string): void {
    if (length === 0) return;
    if (isKey(data, Key.up)) this.cursor = Math.max(0, this.cursor - 1);
    if (isKey(data, Key.down)) this.cursor = Math.min(length - 1, this.cursor + 1);
  }

  private toggle(field: Extract<Field, { kind: "multiselect" }>): void {
    const option = field.options[this.cursor];
    if (!option) return;
    const value = Array.isArray(this.draftValue) ? this.draftValue : [];
    this.draftValue = value.includes(option)
      ? value.filter((entry) => entry !== option)
      : [...value, option];
  }

  private handleNumberInput(
    field: Extract<Field, { kind: "number" }>,
    value: number,
    data: string,
  ): number {
    if (isKey(data, Key.backspace)) return this.clamp(field, Math.floor(value / 10));
    if (/^[0-9]$/.test(data)) return this.clamp(field, value * 10 + Number(data));
    return value;
  }

  private handleTextInput(
    field: Extract<Field, { kind: "text" }>,
    value: string,
    data: string,
  ): string {
    if (isKey(data, Key.backspace)) return value.slice(0, -1);
    if (
      field.multiline &&
      data.length === 1 &&
      (data.charCodeAt(0) === 10 || data.charCodeAt(0) === 13)
    ) {
      return `${value}\n`;
    }
    return data.length >= 1 && !data.startsWith("\x1b") ? value + data : value;
  }

  private clamp(field: Extract<Field, { kind: "number" }>, value: number): number {
    return Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, value));
  }
}
