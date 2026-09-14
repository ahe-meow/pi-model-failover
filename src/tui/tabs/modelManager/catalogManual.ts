import { truncateToWidth } from "@earendil-works/pi-tui";
import type { CatalogModel } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import type { Confirm } from "../../primitives/confirm.js";
import { Form } from "../../primitives/form.js";
import { theme } from "../../primitives/theme.js";
import { catalogManualFields, fitCatalogBody } from "./forms.js";

export function createCatalogManualForm(
  model: CatalogModel | undefined,
  submit: (values: Record<string, unknown>) => void,
  cancel: () => void,
): Form {
  return new Form(catalogManualFields(model), submit, cancel);
}

export function parseCatalogModel(
  values: Record<string, unknown>,
  defaults: Record<string, unknown>,
): CatalogModel | string {
  const id = typeof values.id === "string" ? values.id.trim() : String();
  if (id === "") return S.modelManager.catalog.invalidId;
  const { contextWindow, maxTokens } = values;
  if (
    typeof contextWindow !== "number" ||
    !Number.isFinite(contextWindow) ||
    typeof maxTokens !== "number" ||
    !Number.isFinite(maxTokens)
  )
    return S.modelManager.catalog.invalidNumbers;
  const name = typeof values.name === "string" ? values.name.trim() : String();
  const yes = S.modelManager.catalog.boolean.yes;
  return {
    id,
    ...(name === "" ? {} : { name }),
    reasoning: values.reasoning === yes,
    vision: values.vision === yes,
    contextWindow,
    maxTokens,
    defaults: structuredClone(defaults),
  };
}

export function renderCatalogManual(
  form: Form | undefined,
  error: string | undefined,
  width: number,
  listRows: number,
): string[] {
  const body = form?.render(width) ?? [];
  if (error !== undefined) body.push(theme.danger(`    ${error}`));
  const focus = error === undefined ? (form?.focus ?? 0) : body.length - 1;
  return [
    truncateToWidth(theme.title(S.modelManager.catalog.manualTitle), width),
    ...fitCatalogBody(body, width, listRows, focus),
  ];
}

export function renderCatalogConfirm(
  confirm: Confirm | undefined,
  header: string,
  width: number,
  listRows: number,
): string[] {
  return [
    theme.title(truncateToWidth(header, width)),
    ...fitCatalogBody(confirm?.render(width) ?? [], width, listRows),
  ];
}
