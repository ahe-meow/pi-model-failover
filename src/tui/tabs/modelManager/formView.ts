import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ModelsJson } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import type { Confirm } from "../../primitives/confirm.js";
import { type Field, Form, type FormOptions } from "../../primitives/form.js";
import { theme } from "../../primitives/theme.js";
import type { TabComponent } from "../history.js";
import type { ModelManagerDeps } from "../modelManager.js";

const E = String();
export type Values = Record<string, unknown>;
export const text = (values: Values, field: string): string =>
  typeof values[field] === "string" ? (values[field] as string) : E;
export type Fail = (message: string) => void;
export type FormSubmit = (values: Values, fail: Fail) => Promise<void> | void;
export type TextOptions = { secret?: boolean; multiline?: boolean };
export const textField = (
  key: string,
  label: string,
  value: string,
  options: TextOptions = {},
): Field => ({ kind: "text", key, label, value, ...options }) as Field;
export const numberField = (key: string, label: string, value: number): Field =>
  ({ kind: "number", key, label, value, min: 0 }) as Field;
export const selectField = (key: string, label: string, value: string, options: string[]): Field =>
  ({ kind: "select", key, label, value, options }) as Field;
export const multiselectField = (
  key: string,
  label: string,
  value: string[],
  options: string[],
): Field => ({ kind: "multiselect", key, label, value, options }) as Field;
export const fitCatalogBody = (
  lines: string[],
  width: number,
  listRows: number,
  focusLine = 0,
): string[] =>
  lines
    .slice(Math.max(0, focusLine - listRows + 1))
    .slice(0, listRows)
    .map((line) => truncateToWidth(line, width))
    .concat(Array(Math.max(0, listRows - lines.length)).fill(E));
export function renderModelManagerConfirm(
  confirm: Confirm | undefined,
  title: string,
  width: number,
  listRows: number,
): string[] {
  return [
    theme.title(truncateToWidth(title, width)),
    ...fitCatalogBody(confirm?.render(width) ?? [], width, listRows),
  ];
}
export async function persist(
  options: Pick<ModelManagerDeps, "modelsFile" | "registrar">,
  update: (models: ModelsJson) => ModelsJson,
  done: (models: ModelsJson) => void,
): Promise<void> {
  const next = await options.modelsFile.update(update);
  options.registrar.syncOwned(next);
  done(next);
}
export class FormView implements TabComponent {
  private pending = Promise.resolve();
  private readonly form: Form;
  constructor(
    fields: Field[],
    private readonly title: string,
    notify: (message: string) => void,
    failure: string,
    submit: FormSubmit,
    cancel: () => void,
    options: FormOptions = {},
  ) {
    const fail = (message: string): void => notify(message);
    this.form = new Form(
      fields,
      (values) => {
        this.pending = Promise.resolve(submit(values, fail)).catch(() => fail(failure));
      },
      cancel,
      options,
    );
  }
  render = (width: number, rows: number): string[] => [
    theme.title(truncateToWidth(this.title, width)),
    ...fitCatalogBody(this.form.render(width), width, rows, this.form.focus),
  ];
  handleInput(data: string): void | Promise<void> {
    this.form.handleInput(data);
    return this.pending;
  }
  isEditing(): boolean {
    return this.form.isEditing();
  }
  hints = (): Array<[string, string]> => S.hints.form;
  helpTitle = (): string => this.title;
}
