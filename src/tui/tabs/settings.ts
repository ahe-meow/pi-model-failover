import { Key, type KeyId, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../../config/configStore.js";
import { LIST_ROWS_MAX, LIST_ROWS_MIN } from "../../config/configStore.js";
import type { ServerQualitySettings } from "../../domain/serverQuality.js";
import type { ErrorHandlingMode } from "../../domain/types.js";
import { S } from "../../strings.js";
import { Confirm } from "../primitives/confirm.js";
import { type Field, Form } from "../primitives/form.js";
import { theme } from "../primitives/theme.js";
import type { TabComponent } from "./history.js";

function isKey(data: string, key: KeyId): boolean {
  return data === key || matchesKey(data, key);
}

const SETTING_KEYS = {
  listRows: "listRows",
  ttftTimeoutSeconds: "ttftTimeoutSeconds",
  serverQualityEnabled: "serverQualityEnabled",
  serverQualityTtft: "serverQualityTtft",
  serverQualityNoProgress: "serverQualityNoProgress",
  maxRetries: "maxRetries",
  errorHandlingMode: "errorHandlingMode",
  noProgressTimeoutSeconds: "noProgressTimeoutSeconds",
} as const;

const ERROR_HANDLING_MODE_VALUES = {
  smart: "smart",
  switch: "switch",
  retry: "retry",
} as const;

type QualityKey = "enabled" | "ttft" | "noProgress";

function qualityLabel(value: boolean): string {
  return value ? S.settings.options.serverQuality.on : S.settings.options.serverQuality.off;
}

function qualityValue(value: unknown): boolean {
  return value === S.settings.options.serverQuality.on;
}

function errorHandlingModeLabel(value: ErrorHandlingMode): string {
  switch (value) {
    case ERROR_HANDLING_MODE_VALUES.smart:
      return S.settings.options.errorHandlingMode.smart;
    case ERROR_HANDLING_MODE_VALUES.switch:
      return S.settings.options.errorHandlingMode.switch;
    case ERROR_HANDLING_MODE_VALUES.retry:
      return S.settings.options.errorHandlingMode.retry;
    default:
      return S.settings.options.errorHandlingMode.smart;
  }
}

function errorHandlingModeValue(value: unknown): ErrorHandlingMode {
  if (value === S.settings.options.errorHandlingMode.switch) {
    return ERROR_HANDLING_MODE_VALUES.switch;
  }
  if (value === S.settings.options.errorHandlingMode.retry) {
    return ERROR_HANDLING_MODE_VALUES.retry;
  }
  return ERROR_HANDLING_MODE_VALUES.smart;
}

function qualityDisabled(settings: ServerQualitySettings): boolean {
  return !settings.enabled || (!settings.ttft && !settings.noProgress);
}

function qualityField(
  key: string,
  label: string,
  qualityKey: QualityKey,
  settings: ServerQualitySettings,
): Field {
  const warning = qualityDisabled(settings)
    ? {
        [S.settings.options.serverQuality.on]: S.serverQualityDisabledWarning,
        [S.settings.options.serverQuality.off]: S.serverQualityDisabledWarning,
      }
    : undefined;
  return {
    kind: "select",
    key,
    label,
    value: qualityLabel(settings[qualityKey]),
    options: [S.settings.options.serverQuality.on, S.settings.options.serverQuality.off],
    ...(warning === undefined || qualityKey !== "enabled" ? {} : { warning }),
  };
}

export class SettingsTab implements TabComponent {
  private form: Form;
  private confirm: Confirm | null = null;
  private onReset = false;
  private labelWidth = 26;
  private pendingSave: Promise<void> | undefined;

  constructor(
    private config: ConfigStore,
    private resetAll: () => Promise<number>,
    private countTargets: () => number = () => 0,
  ) {
    this.form = this.buildForm();
    config.onChange(() => {
      this.form = this.buildForm();
    });
  }

  private buildForm(): Form {
    const settings = this.config.get().settings;
    const fields: Field[] = [
      {
        kind: "number",
        key: SETTING_KEYS.listRows,
        label: `${S.settings.labels.listRows} ${S.help.listRowsHint}`,
        value: settings[SETTING_KEYS.listRows],
        min: LIST_ROWS_MIN,
        max: LIST_ROWS_MAX,
      },
      {
        kind: "number",
        key: SETTING_KEYS.ttftTimeoutSeconds,
        label: `${S.settings.labels.ttftTimeoutSeconds} ${S.help.zeroDisables}`,
        value: settings[SETTING_KEYS.ttftTimeoutSeconds],
        min: 0,
        max: 3600,
      },
      qualityField(
        SETTING_KEYS.serverQualityEnabled,
        S.settings.labels.serverQualityEnabled,
        "enabled",
        settings.serverQuality,
      ),
      qualityField(
        SETTING_KEYS.serverQualityTtft,
        S.settings.labels.serverQualityTtft,
        "ttft",
        settings.serverQuality,
      ),
      qualityField(
        SETTING_KEYS.serverQualityNoProgress,
        S.settings.labels.serverQualityNoProgress,
        "noProgress",
        settings.serverQuality,
      ),
      {
        kind: "number",
        key: SETTING_KEYS.maxRetries,
        label: S.settings.labels.maxRetries,
        value: settings[SETTING_KEYS.maxRetries],
        min: 0,
        max: 50,
      },
      {
        kind: "select",
        key: SETTING_KEYS.errorHandlingMode,
        label: S.settings.labels.errorHandlingMode,
        value: errorHandlingModeLabel(settings[SETTING_KEYS.errorHandlingMode]),
        options: [
          S.settings.options.errorHandlingMode.smart,
          S.settings.options.errorHandlingMode.switch,
          S.settings.options.errorHandlingMode.retry,
        ],
      },
      {
        kind: "number",
        key: SETTING_KEYS.noProgressTimeoutSeconds,
        label: S.settings.labels.noProgressTimeoutSeconds,
        value: settings[SETTING_KEYS.noProgressTimeoutSeconds],
        min: 0,
        max: 3600,
      },
    ];
    const labelWidth = Math.max(...fields.map(({ label }) => label.length)) + 4;
    this.labelWidth = labelWidth;
    return new Form(
      fields,
      (values) => {
        this.pendingSave = this.save(values);
      },
      () => {},
      { labelWidth },
    );
  }

  private renderHeader(width: number): string {
    const [setting = "", value = ""] = S.settings.tableHeader.split(/\s{2,}/);
    return truncateToWidth(theme.header(`${setting.padEnd(this.labelWidth)}${value}`), width);
  }

  private async save(values: Record<string, unknown>): Promise<void> {
    try {
      await this.config.update((config) => {
        config.settings[SETTING_KEYS.listRows] = values[SETTING_KEYS.listRows] as number;
        config.settings[SETTING_KEYS.ttftTimeoutSeconds] = values[
          SETTING_KEYS.ttftTimeoutSeconds
        ] as number;
        config.settings.serverQuality.enabled = qualityValue(
          values[SETTING_KEYS.serverQualityEnabled],
        );
        config.settings.serverQuality.ttft = qualityValue(values[SETTING_KEYS.serverQualityTtft]);
        config.settings.serverQuality.noProgress = qualityValue(
          values[SETTING_KEYS.serverQualityNoProgress],
        );
        config.settings[SETTING_KEYS.maxRetries] = values[SETTING_KEYS.maxRetries] as number;
        config.settings[SETTING_KEYS.errorHandlingMode] = errorHandlingModeValue(
          values[SETTING_KEYS.errorHandlingMode],
        );
        config.settings[SETTING_KEYS.noProgressTimeoutSeconds] = values[
          SETTING_KEYS.noProgressTimeoutSeconds
        ] as number;
      });
    } catch {
      this.form = this.buildForm();
    }
  }

  private focusedBodyLine(bodyLength: number): number {
    if (this.onReset) return bodyLength - 1;
    const values = this.form.values();
    const warningOffset =
      this.form.focus > 2 &&
      qualityDisabled({
        enabled: qualityValue(values[SETTING_KEYS.serverQualityEnabled]),
        ttft: qualityValue(values[SETTING_KEYS.serverQualityTtft]),
        noProgress: qualityValue(values[SETTING_KEYS.serverQualityNoProgress]),
      })
        ? 1
        : 0;
    return this.form.focus + warningOffset;
  }

  private visibleBody(body: string[], listRows: number): string[] {
    const maxStart = Math.max(0, body.length - listRows);
    const focusedLine = this.focusedBodyLine(body.length);
    const start = Math.min(maxStart, Math.max(0, focusedLine - listRows + 1));
    const visible = body.slice(start, start + listRows);
    while (visible.length < listRows) visible.push("");
    return visible;
  }

  render(width: number, listRows: number): string[] {
    if (this.confirm) {
      const body = this.confirm.render(width).slice(0, listRows);
      while (body.length < listRows) body.push("");
      return [truncateToWidth(theme.title(S.settingsHeader), width), ...body];
    }
    const button = this.onReset
      ? `\x1b[7m${theme.danger(`[ ${S.resetAll} ]`)}\x1b[27m`
      : theme.danger(`  [ ${S.resetAll} ]`);
    const body = [...this.form.render(width), truncateToWidth(button, width)];
    const bodyRows = Math.max(0, listRows - 1);
    return [
      truncateToWidth(theme.title(S.settingsHeader), width),
      this.renderHeader(width),
      ...this.visibleBody(body, bodyRows),
    ];
  }

  capturesNumericInput(): boolean {
    return (
      this.confirm !== null ||
      this.onReset ||
      this.form.focus === 0 ||
      this.form.focus === 1 ||
      this.form.focus === 5 ||
      this.form.focus === 7
    );
  }

  async handleInput(data: string): Promise<void> {
    if (this.confirm) {
      this.confirm.handleInput(data);
      return;
    }
    if (this.onReset) {
      if (isKey(data, Key.up)) {
        this.onReset = false;
        return;
      }
      if (isKey(data, Key.enter)) {
        this.confirm = new Confirm(
          S.resetAllConfirm(this.countTargets()),
          [],
          async () => {
            this.confirm = null;
            await this.resetAll();
          },
          () => {
            this.confirm = null;
          },
        );
      }
      return;
    }
    if (isKey(data, Key.down) && this.form.focus === 7) {
      this.onReset = true;
      return;
    }
    this.form.handleInput(data);
    if (isKey(data, Key.ctrl("s"))) await this.waitForSave();
  }

  private async waitForSave(): Promise<void> {
    const pending = this.pendingSave;
    if (pending === undefined) return;
    await pending;
    if (this.pendingSave === pending) this.pendingSave = undefined;
  }

  isEditing(): boolean {
    return this.form.isEditing();
  }

  hints(): Array<[string, string]> {
    return this.confirm ? S.hints.confirm : S.hints.settings;
  }

  helpTitle(): string {
    return S.tabs[3];
  }
}
