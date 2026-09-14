import { Key, type KeyId, matchesKey } from "@earendil-works/pi-tui";
import { isDrifted } from "../../../domain/catalog.js";
import { listProviders } from "../../../domain/providers.js";
import { redactSecret } from "../../../domain/redact.js";
import type { CatalogModel, ModelNode, ModelsJson, ProviderNode } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import type { Row, ScrollList } from "../../primitives/scrollList.js";
import { filterRows } from "../../primitives/textFilter.js";
import { theme } from "../../primitives/theme.js";

const isKey = (data: string, key: KeyId): boolean => data === key || matchesKey(data, key);

export function providerRow(entry: ReturnType<typeof listProviders>[number]): Row {
  let owner = String();
  if (entry.owned) owner = theme.success(S.modelManager.failoverOwner);
  else if (entry.node.piModelManager?.managed) owner = theme.success(S.modelManager.pmmOwner);
  const multiplier =
    entry.multiplier === null
      ? String()
      : `${entry.multiplier.toFixed(2)}${S.modelManager.multiplierSuffix}`;
  const cells = [
    entry.id,
    entry.node.api ?? String(),
    String(entry.node.models.length),
    multiplier,
    owner,
  ];
  return { text: cells.join("  "), cells };
}

export function modelRow(node: ModelNode, catalog: CatalogModel[]): Row {
  const source = catalog.find(({ id }) => id === node.id);
  const drift =
    source !== undefined && isDrifted(node, source) ? ` ${S.modelManager.driftMarker}` : String();
  const cells = [
    node.id,
    `${node.contextWindow} ${S.modelManager.contextLabel}`,
    `${node.maxTokens} ${S.modelManager.maxTokensLabel}`,
    `${node.reasoning ? S.modelManager.reasoningLabel : S.modelManager.notReasoning}${drift}`,
  ];
  return { text: cells.join("  "), cells };
}

export function filteredProviderRows(
  models: ModelsJson,
  query: string,
): { rows: Row[]; providers: ReturnType<typeof listProviders> } {
  const filtered = filterRows(listProviders(models), providerRow, query);
  return { rows: filtered.map(({ row }) => row), providers: filtered.map(({ item }) => item) };
}

export function filteredModelRows(
  provider: ProviderNode,
  catalog: CatalogModel[],
  query: string,
  markedIds: ReadonlySet<string>,
): { rows: Row[]; models: ModelNode[] } {
  const filtered = filterRows(
    provider.models,
    (node) => {
      const row = modelRow(node, catalog);
      return node.name === undefined ? row : { ...row, text: `${row.text}  ${node.name}` };
    },
    query,
  );
  return {
    rows: filtered.map(({ item, row }) => ({
      ...row,
      ...(markedIds.has(item.id) ? { marked: true } : {}),
    })),
    models: filtered.map(({ item }) => item),
  };
}

export function selectedProvider(
  models: ModelsJson,
  selectedProviderId: string | undefined,
): ProviderNode | undefined {
  return selectedProviderId === undefined ? undefined : models.providers[selectedProviderId];
}

export function detailHeader(id: string, provider: ProviderNode): string {
  const key =
    provider.apiKey === undefined ? S.modelManager.missingKey : redactSecret(provider.apiKey);
  let url: string = S.modelManager.missingKey;
  if (provider.baseUrl !== undefined) {
    url =
      provider.apiKey === undefined
        ? provider.baseUrl
        : provider.baseUrl.split(provider.apiKey).join(key);
  }
  const multiplier =
    provider.piModelFailover === undefined
      ? String()
      : `${provider.piModelFailover.costMultiplier.toFixed(2)}${S.modelManager.multiplierSuffix}`;
  return `${id}  ${url}  ${provider.api ?? String()}  ${S.modelManager.keyLabel} ${key}  ${multiplier}`;
}

export function move(list: ScrollList, data: string): void {
  const index = [Key.up, Key.down, Key.pageUp, Key.pageDown, Key.home, Key.end].findIndex((key) =>
    isKey(data, key),
  );
  [list.up, list.down, list.pageUp, list.pageDown, list.home, list.end][index]?.call(list);
}
