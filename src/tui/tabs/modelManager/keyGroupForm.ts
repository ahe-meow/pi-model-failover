import { truncateToWidth } from "@earendil-works/pi-tui";
import { createKeyGroup, type KeyEntry } from "../../../domain/keyGroups.js";
import { upsertProvider } from "../../../domain/providers.js";
import { redactSecret } from "../../../domain/redact.js";
import type { ApiType, KeyGroup, ModelsJson } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import { type Field, Form } from "../../primitives/form.js";
import { theme } from "../../primitives/theme.js";
import type { TabComponent } from "../history.js";
import type { ModelManagerDeps } from "../modelManager.js";

const API_OPTIONS = S.modelManager.keyGroupForm.apiOptions as readonly ApiType[];
const KEY_FIELD = "keys";

type ParsedValues = {
  prefix: string;
  baseUrl: string;
  api: ApiType;
  headers: Record<string, string>;
  keys: KeyEntry[];
};

function textValue(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value : "";
}

function positiveNumber(value: string): number | undefined {
  const number = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(number) && number > 0 ? number : undefined;
}

function parseHeaders(value: string): Record<string, string> | string {
  const headers: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const separator = trimmed.indexOf(":");
    const name = separator < 0 ? "" : trimmed.slice(0, separator).trim();
    if (separator < 1 || name === "") return S.modelManager.keyGroupForm.invalidHeaders;
    headers[name] = trimmed.slice(separator + 1).trim();
  }
  return headers;
}

function parseKeys(value: string, defaultMultiplier: number): KeyEntry[] | string {
  const keys: KeyEntry[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const tokens = line.split(/\s+/);
    if (tokens.length > 2 || tokens[0] === "") {
      return S.modelManager.keyGroupForm.invalidKeyLine;
    }
    const key = tokens[0];
    const multiplier = tokens[1] === undefined ? defaultMultiplier : positiveNumber(tokens[1]);
    if (key === undefined || multiplier === undefined) {
      return S.modelManager.keyGroupForm.invalidMultiplier;
    }
    keys.push({ key, multiplier });
  }
  return keys.length === 0 ? S.modelManager.keyGroupForm.emptyKeys : keys;
}

function parseValues(values: Record<string, unknown>): ParsedValues | string {
  const prefix = textValue(values, "prefix");
  if (prefix === "" || /[\s/]/.test(prefix)) {
    return S.modelManager.keyGroupForm.invalidPrefix;
  }

  const baseUrl = textValue(values, "baseUrl").trim();
  try {
    const protocol = new URL(baseUrl).protocol;
    const isHttp = protocol === "http:";
    const isHttps = protocol === "https:";
    if (!isHttp && !isHttps) {
      return S.modelManager.keyGroupForm.invalidUrl;
    }
  } catch {
    return S.modelManager.keyGroupForm.invalidUrl;
  }

  const apiValue = textValue(values, "api");
  if (!API_OPTIONS.includes(apiValue as ApiType)) {
    return S.modelManager.keyGroupForm.invalidApi;
  }

  const headers = parseHeaders(textValue(values, "headers"));
  if (typeof headers === "string") return headers;

  const multiplier = positiveNumber(textValue(values, "multiplier"));
  if (multiplier === undefined) return S.modelManager.keyGroupForm.invalidMultiplier;

  const keys = parseKeys(textValue(values, KEY_FIELD), multiplier);
  if (typeof keys === "string") return keys;

  return { prefix, baseUrl, api: apiValue as ApiType, headers, keys };
}

function redactedKey(value: string): string {
  return value === "" ? "" : redactSecret(value);
}

function displayHeader(value: string): string {
  const separator = value.indexOf(":");
  if (separator < 1 || !/key|token|auth/i.test(value.slice(0, separator))) return value;
  const name = value.slice(0, separator);
  const headerValue = value.slice(separator + 1).trim();
  return `${name}: ${redactedKey(headerValue)}`;
}

export class KeyGroupForm implements TabComponent {
  private readonly fields: Field[];
  private readonly form: Form;
  private pending = Promise.resolve();
  private error: string | undefined;

  constructor(private readonly deps: ModelManagerDeps & { onDone: (models: ModelsJson) => void }) {
    const labels = S.modelManager.keyGroupForm.labels;
    this.fields = [
      {
        kind: "text",
        key: "prefix",
        label: labels.prefix,
        value: "",
      },
      {
        kind: "text",
        key: "baseUrl",
        label: labels.baseUrl,
        value: "",
      },
      {
        kind: "select",
        key: "api",
        label: labels.api,
        value: API_OPTIONS[0] ?? "",
        options: [...API_OPTIONS],
      },
      {
        kind: "text",
        key: "headers",
        label: labels.headers,
        value: "",
        multiline: true,
      },
      {
        kind: "text",
        key: "multiplier",
        label: labels.multiplier,
        value: "1",
      },
      {
        kind: "text",
        key: KEY_FIELD,
        label: `${labels.keys} ${S.modelManager.keyGroupForm.keysHint}`,
        value: "",
        secret: true,
        multiline: true,
      },
    ];
    this.form = new Form(
      this.fields,
      (values) => {
        this.pending = this.submit(values);
      },
      () => this.deps.notify(S.modelManager.keyGroupForm.cancelled),
    );
  }

  render(width: number, listRows: number): string[] {
    if (this.form.isEditing()) {
      return [
        truncateToWidth(theme.title(S.modelManager.keyGroupForm.title), width),
        ...this.form.render(width),
      ];
    }
    const body: string[] = [];
    let focusedLine = 0;
    for (const [index, field] of this.fields.entries()) {
      if (index === this.form.focus) focusedLine = body.length;
      body.push(...this.renderField(field, index, width));
    }
    if (this.error !== undefined)
      body.push(truncateToWidth(theme.danger(`    ${this.error}`), width));

    const rows = Math.max(0, listRows);
    const maxStart = Math.max(0, body.length - rows);
    const start = Math.min(maxStart, Math.max(0, focusedLine - rows + 1));
    const visible = body.slice(start, start + rows);
    while (visible.length < rows) visible.push("");
    return [truncateToWidth(theme.title(S.modelManager.keyGroupForm.title), width), ...visible];
  }

  async handleInput(data: string): Promise<void> {
    this.error = undefined;
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
    return S.modelManager.keyGroupForm.title;
  }

  private renderField(field: Field, index: number, width: number): string[] {
    const label = field.label.padEnd(26);
    if (field.kind === "select") {
      const options = field.options
        .map((option) => `[${option === field.value ? "x" : " "}] ${option}`)
        .join("  ");
      const line = truncateToWidth(`${label}${options}`, width);
      return [index === this.form.focus ? `\x1b[7m${line}\x1b[27m` : line];
    }
    if (field.kind !== "text") return [];

    const values = field.value.split(/\r?\n/);
    const display = field.key === KEY_FIELD ? redactedKey : displayHeader;
    return values.map((value, lineIndex) => {
      const linePrefix = lineIndex === 0 ? label : " ".repeat(26);
      const line = truncateToWidth(`${linePrefix}${display(value)}`, width);
      return index === this.form.focus && lineIndex === 0 ? `\x1b[7m${line}\x1b[27m` : line;
    });
  }

  private async submit(values: Record<string, unknown>): Promise<void> {
    const parsed = parseValues(values);
    if (typeof parsed === "string") {
      this.error = parsed;
      this.deps.notify(parsed);
      return;
    }
    this.error = undefined;

    const groupId = this.deps.createKeyGroupId();
    const createdAt = this.deps.now();
    let savedGroup: KeyGroup | undefined;
    let next: ModelsJson;
    try {
      next = await this.deps.modelsFile.update((models) => {
        const built = createKeyGroup({
          prefix: parsed.prefix,
          template: { baseUrl: parsed.baseUrl, api: parsed.api, headers: parsed.headers },
          keys: parsed.keys,
          now: createdAt,
          id: groupId,
          existingIds: Object.keys(models.providers),
        });
        savedGroup = built.group;
        return Object.entries(built.providers).reduce(
          (working, [id, provider]) => upsertProvider(working, id, provider),
          models,
        );
      });
      if (!savedGroup) throw new Error("missing");
      const group = savedGroup;
      await this.deps.config.update((config) => {
        config.keyGroups.push(group);
      });
    } catch {
      this.deps.notify(S.modelManager.keyGroupForm.saveFailed);
      return;
    }

    this.deps.registrar.syncOwned(next);
    this.deps.notify(S.modelManager.keyGroupForm.saved);
    this.deps.onDone(next);
  }
}
