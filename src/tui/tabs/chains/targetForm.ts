import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../../../config/configStore.js";
import { resolveTargetSettings } from "../../../domain/chains.js";
import type {
  Chain,
  ErrorHandlingMode,
  ModelsJson,
  TargetSettings,
} from "../../../domain/types.js";
import { S } from "../../../strings.js";
import { type Field, Form } from "../../primitives/form.js";
import { theme } from "../../primitives/theme.js";
import type { TabComponent } from "../history.js";

const E = String();
const MODEL_PARAMETERS = "modelParameters";
type Option<T extends string> = { value: T; label: string };
type Registrar = { syncFailover(chains: Chain[], models: ModelsJson): void };

export interface TargetFormOptions {
  config: ConfigStore;
  chainId: string;
  targetIndex: number;
  models: () => ModelsJson;
  registrar: Registrar;
  notify: (message: string) => void;
  onDone: () => void;
  onCancel: () => void;
}

const ERROR_OPTIONS: readonly Option<ErrorHandlingMode>[] = [
  { value: "smart", label: S.chains.targetForm.options.errorHandlingMode.smart },
  { value: "switch", label: S.chains.targetForm.options.errorHandlingMode.switch },
  { value: "retry", label: S.chains.targetForm.options.errorHandlingMode.retry },
];
const REASONING_OPTIONS: readonly Option<TargetSettings["reasoningEffort"]>[] = [
  { value: "inherit", label: S.chains.targetForm.options.reasoningEffort.inherit },
  { value: "minimal", label: S.chains.targetForm.options.reasoningEffort.minimal },
  { value: "low", label: S.chains.targetForm.options.reasoningEffort.low },
  { value: "medium", label: S.chains.targetForm.options.reasoningEffort.medium },
  { value: "high", label: S.chains.targetForm.options.reasoningEffort.high },
];
const TTFT_OPTIONS: readonly Option<TargetSettings["ttftAction"]>[] = [
  { value: "cooldown-only", label: S.chains.targetForm.options.ttftAction.cooldownOnly },
  { value: "abort", label: S.chains.targetForm.options.ttftAction.abort },
];

function optionField<T extends string>(
  key: string,
  label: string,
  value: T,
  options: readonly Option<T>[],
  warning?: Partial<Record<string, string>>,
): Field {
  return {
    kind: "select",
    key,
    label,
    value: options.find((option) => option.value === value)?.label ?? options[0]?.label ?? E,
    options: options.map((option) => option.label),
    ...(warning === undefined ? {} : { warning }),
  };
}
function numberField(key: string, label: string, value: number): Field {
  return { kind: "number", key, label, value, min: 0 };
}
function textField(key: string, label: string, value: string): Field {
  return { kind: "text", key, label, value, multiline: key === MODEL_PARAMETERS };
}
function fitBody(lines: string[], width: number, rows: number): string[] {
  const body = lines.slice(0, rows).map((line) => truncateToWidth(line, width));
  while (body.length < rows) body.push(E);
  return body;
}
function text(values: Record<string, unknown>, key: string): string {
  return typeof values[key] === "string" ? (values[key] as string) : E;
}
function number(values: Record<string, unknown>, key: string): number | undefined {
  const value = Number(values[key]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
function selected<T extends string>(
  values: Record<string, unknown>,
  key: string,
  options: readonly Option<T>[],
): T | undefined {
  const label = text(values, key);
  return options.find((option) => option.label === label)?.value;
}
function fields(settings: TargetSettings): Field[] {
  const labels = S.chains.targetForm.labels;
  return [
    optionField(
      "errorHandlingMode",
      labels.errorHandlingMode,
      settings.errorHandlingMode,
      ERROR_OPTIONS,
    ),
    numberField("maxRetries", labels.maxRetries, settings.maxRetries),
    optionField(
      "reasoningEffort",
      labels.reasoningEffort,
      settings.reasoningEffort,
      REASONING_OPTIONS,
    ),
    numberField(
      "noProgressTimeoutSeconds",
      labels.noProgressTimeoutSeconds,
      settings.noProgressTimeoutSeconds,
    ),
    numberField("ttftTimeoutSeconds", labels.ttftTimeoutSeconds, settings.ttftTimeoutSeconds),
    optionField("ttftAction", labels.ttftAction, settings.ttftAction, TTFT_OPTIONS, {
      [S.chains.targetForm.options.ttftAction.abort]: S.abortWarning,
    }),
    textField("modelParameters", labels.modelParameters, JSON.stringify(settings.modelParameters)),
  ];
}
function parseSettings(values: Record<string, unknown>): TargetSettings | string {
  const errorHandlingMode = selected(values, "errorHandlingMode", ERROR_OPTIONS);
  const reasoningEffort = selected(values, "reasoningEffort", REASONING_OPTIONS);
  const ttftAction = selected(values, "ttftAction", TTFT_OPTIONS);
  const maxRetries = number(values, "maxRetries");
  const noProgressTimeoutSeconds = number(values, "noProgressTimeoutSeconds");
  const ttftTimeoutSeconds = number(values, "ttftTimeoutSeconds");
  if (
    errorHandlingMode === undefined ||
    reasoningEffort === undefined ||
    ttftAction === undefined ||
    maxRetries === undefined ||
    noProgressTimeoutSeconds === undefined ||
    ttftTimeoutSeconds === undefined
  )
    return S.chains.form.saveFailed;
  const raw = text(values, "modelParameters").trim();
  if (raw === E)
    return {
      errorHandlingMode,
      maxRetries,
      reasoningEffort,
      modelParameters: {},
      noProgressTimeoutSeconds,
      ttftTimeoutSeconds,
      ttftAction,
    };
  try {
    const modelParameters: unknown = JSON.parse(raw);
    if (
      modelParameters === null ||
      typeof modelParameters !== "object" ||
      Array.isArray(modelParameters)
    )
      return S.chains.targetForm.invalidParameters;
    return {
      errorHandlingMode,
      maxRetries,
      reasoningEffort,
      modelParameters: structuredClone(modelParameters) as Record<string, unknown>,
      noProgressTimeoutSeconds,
      ttftTimeoutSeconds,
      ttftAction,
    };
  } catch {
    return S.chains.targetForm.invalidParameters;
  }
}

export class TargetForm implements TabComponent {
  private readonly form: Form;
  private pending = Promise.resolve();

  constructor(private readonly options: TargetFormOptions) {
    const config = options.config.get();
    const chain = config.chains.find((candidate) => candidate.id === options.chainId);
    const target = chain?.targets[options.targetIndex] ?? { provider: E, modelId: E };
    this.form = new Form(
      fields(resolveTargetSettings(target, config.settings)),
      (values) => {
        this.pending = this.save(values);
      },
      options.onCancel,
    );
  }

  render(width: number, rows: number): string[] {
    const chain = this.options.config
      .get()
      .chains.find((candidate) => candidate.id === this.options.chainId);
    const target = chain?.targets[this.options.targetIndex];
    const ref = target === undefined ? E : `${target.provider}/${target.modelId}`;
    return [
      theme.title(truncateToWidth(S.chains.targetForm.title(ref), width)),
      ...fitBody(this.form.render(width), width, rows),
    ];
  }

  async handleInput(data: string): Promise<void> {
    this.form.handleInput(data);
    const operation = this.pending;
    await operation;
    if (this.pending === operation) this.pending = Promise.resolve();
  }

  isEditing(): boolean {
    return this.form.isEditing();
  }

  hints(): Array<[string, string]> {
    return S.hints.form;
  }

  helpTitle(): string {
    return S.chains.targetForm.title(E);
  }

  private async save(values: Record<string, unknown>): Promise<void> {
    const parsed = parseSettings(values);
    if (typeof parsed === "string") {
      this.options.notify(parsed);
      return;
    }
    try {
      await this.options.config.update((config) => {
        const chain = config.chains.find((candidate) => candidate.id === this.options.chainId);
        const target = chain?.targets[this.options.targetIndex];
        if (target === undefined) throw new Error(S.chains.targetForm.saveFailed);
        Object.assign(target, parsed, { modelParameters: structuredClone(parsed.modelParameters) });
      });
      this.options.registrar.syncFailover(
        structuredClone(this.options.config.get().chains),
        this.options.models(),
      );
      this.options.onDone();
    } catch {
      this.options.notify(S.chains.targetForm.saveFailed);
    }
  }
}
