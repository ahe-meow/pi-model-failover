import { truncateToWidth } from "@earendil-works/pi-tui";
import { supportedReasoningLevels } from "../../../domain/catalog.js";
import type { CatalogModel } from "../../../domain/types.js";
import { REASONING_LEVELS, type ReasoningLevel } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import { type Field, Form } from "../../primitives/form.js";
import { theme } from "../../primitives/theme.js";
import type { TabComponent } from "../history.js";
import { fitCatalogBody } from "./formView.js";

const C = S.modelManager.catalog;

const levelLabel = (level: ReasoningLevel): string =>
  S.chains.targetForm.options.reasoningEffort[level];
const levelOptions = REASONING_LEVELS.map(levelLabel);

function commonLevels(models: CatalogModel[]): ReasoningLevel[] {
  return REASONING_LEVELS.filter((level) =>
    models.every((model) => supportedReasoningLevels(model).includes(level)),
  );
}

function selectedLevels(values: Record<string, unknown>): ReasoningLevel[] {
  const selected = new Set(Array.isArray(values.levels) ? values.levels : []);
  return REASONING_LEVELS.filter((level) => selected.has(levelLabel(level)));
}

function reasoningFields(models: CatalogModel[]): Field[] {
  return [
    {
      kind: "multiselect",
      key: "levels",
      label: C.reasoningSupport,
      value: commonLevels(models).map(levelLabel),
      options: levelOptions,
    },
  ];
}

export class CatalogReasoningEditor implements TabComponent {
  private readonly form: Form;

  constructor(
    private readonly models: CatalogModel[],
    submit: (levels: readonly ReasoningLevel[]) => void,
    cancel: () => void,
  ) {
    this.form = new Form(
      reasoningFields(models),
      (values) => submit(selectedLevels(values)),
      cancel,
    );
  }

  render(width: number, listRows: number): string[] {
    const summaries = this.models.map((model) =>
      C.reasoningModel(
        model.id,
        supportedReasoningLevels(model).map(levelLabel).join(", ") || C.reasoningNone,
      ),
    );
    const editing = this.form.isEditing();
    const formRows = this.form.render(width);
    const body = editing ? formRows.slice(1, -1) : [...summaries, ...formRows];
    const focus = editing ? 0 : summaries.length + this.form.focus;
    return [
      theme.title(truncateToWidth(C.reasoningTitle(this.models.length), width)),
      ...fitCatalogBody(body, width, listRows, focus),
    ];
  }

  handleInput(data: string): void {
    this.form.handleInput(data);
  }

  isEditing(): boolean {
    return this.form.isEditing();
  }

  hints(): Array<[string, string]> {
    return S.hints.form;
  }

  helpTitle(): string {
    return C.reasoningTitle(this.models.length);
  }
}
