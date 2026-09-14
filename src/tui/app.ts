import { Key, type KeyId, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Fetch } from "../domain/ports.js";
import { S } from "../strings.js";
import { HelpOverlay } from "./primitives/helpOverlay.js";
import { renderKeyHints } from "./primitives/keyHints.js";
import { TabBar } from "./primitives/tabBar.js";
import { theme } from "./primitives/theme.js";
import { type ChainsDeps, ChainsTab } from "./tabs/chains.js";
import { HistoryTab, type TabComponent } from "./tabs/history.js";
import { type ModelManagerDeps, ModelManagerTab } from "./tabs/modelManager.js";
import { SettingsTab } from "./tabs/settings.js";

function isKey(data: string, key: KeyId): boolean {
  return data === key || matchesKey(data, key);
}

type AppRegistrar = ModelManagerDeps["registrar"];
type FailoverRegistrar = ChainsDeps["registrar"];

export interface AppDeps
  extends Omit<ModelManagerDeps, "registrar">,
    Omit<ChainsDeps, "registrar"> {
  registrar: AppRegistrar & FailoverRegistrar;
  fetch: Fetch;
  runtimeFactory: () => Promise<{ getModels(): unknown[] }>;
  memoryMode: () => boolean;
  resetAll: () => Promise<number>;
  countTargets: () => number;
  close: () => void;
}

export interface PiComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate?(): void;
  focused?: boolean;
}

export function createApp(deps: AppDeps): PiComponent {
  const tabs: TabComponent[] = [
    new ModelManagerTab(deps),
    new ChainsTab(deps),
    new HistoryTab(deps),
    new SettingsTab(deps.config, deps.resetAll, deps.countTargets),
  ];
  const bar = new TabBar([...S.tabs]);
  const help = new HelpOverlay([]);
  let lastHeight = 12;

  const render = (width: number): string[] => {
    const listRows = deps.config.get().settings.listRows;
    const tab = tabs[bar.active];
    if (!tab) return [];
    if (help.visible) {
      help.setSections([
        { title: S.help.global, hints: S.hints.global },
        { title: tab.helpTitle(), hints: tab.hints() },
      ]);
      return help.render(width, lastHeight);
    }
    const title = deps.memoryMode() ? `${S.appTitle}  ${S.memoryMode}` : S.appTitle;
    const body = tab.render(width, listRows);
    const out = [
      truncateToWidth(` ${theme.title(title)}`, width),
      ` ${bar.render(width - 1)}`,
      ...body,
      theme.muted("─".repeat(width)),
      ...renderKeyHints(tab.hints(), width),
    ];
    lastHeight = out.length;
    return out;
  };

  const handleInput = (data: string): void => {
    const activeTab = tabs[bar.active];
    if (activeTab?.isEditing?.()) {
      void activeTab.handleInput(data);
      return;
    }
    if (isKey(data, Key.question)) {
      help.toggle();
      return;
    }
    if (help.visible) {
      if (isKey(data, Key.escape)) help.toggle();
      return;
    }
    if (isKey(data, "q")) {
      deps.close();
      return;
    }
    if (isKey(data, Key.tab)) {
      bar.next();
      return;
    }
    if (isKey(data, Key.shift("tab"))) {
      bar.prev();
      return;
    }
    if (/^[1-4]$/.test(data)) {
      if (!(activeTab instanceof SettingsTab && activeTab.capturesNumericInput())) {
        bar.set(Number(data) - 1);
        return;
      }
    }
    void activeTab?.handleInput(data);
  };

  return { render, handleInput, focused: true };
}
