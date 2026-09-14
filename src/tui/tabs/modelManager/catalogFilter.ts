import type { CatalogModel, ModelsJson } from "../../../domain/types.js";
import type { MultiSelectList } from "../../primitives/multiSelectList.js";
import type { Row } from "../../primitives/scrollList.js";
import { filterRows, TextFilter } from "../../primitives/textFilter.js";
import {
  CATALOG_MODES,
  type CatalogMode,
  type CatalogProviderChoice,
  catalogPick,
  catalogRow,
  catalogProviderRow as providerRow,
} from "./forms.js";

export type CatalogFilters = Record<CatalogMode, TextFilter>;

export function syncCatalogList(
  source: CatalogModel[],
  previous: CatalogModel[],
  list: MultiSelectList,
): CatalogModel[] {
  const marked = new Set(catalogPick(previous, list.markedIndices()).map(({ id }) => id));
  const models = source.map((model) => structuredClone(model));
  list.setRows(
    models.map((model) => ({
      ...catalogRow(model),
      ...(marked.has(model.id) ? { marked: true } : {}),
    })),
  );
  return models;
}

export function catalogProviders(models: ModelsJson): CatalogProviderChoice[] {
  return Object.entries(models.providers).flatMap(([id, node]) =>
    id === "failover" ? [] : [{ id, node: structuredClone(node) }],
  );
}

export const createCatalogFilters = (): CatalogFilters =>
  Object.fromEntries(CATALOG_MODES.map((mode) => [mode, new TextFilter()])) as CatalogFilters;

function visible<T>(
  items: readonly T[],
  filter: TextFilter,
  list: MultiSelectList,
  toRow: (item: T, index: number) => Row,
): T[] {
  const filtered = filterRows(items, toRow, filter.query);
  list.setVisibleIndices(filtered.map(({ index }) => index));
  return filtered.map(({ item }) => item);
}

export function filterCatalogLists(
  mode: CatalogMode,
  filters: CatalogFilters,
  lists: Record<CatalogMode, MultiSelectList>,
  catalogModels: CatalogModel[],
  providers: CatalogProviderChoice[],
  importModels: CatalogModel[],
): CatalogModel[] | undefined {
  const filter = filters[mode];
  if (mode === "catalog") return visible(catalogModels, filter, lists.catalog, catalogRow);
  if (mode === "endpoint-provider" || mode === "provider-targets") {
    visible(providers, filter, lists[mode], providerRow);
  } else visible(importModels, filter, lists[mode], catalogRow);
  return undefined;
}

export function selectedCatalogIds(
  catalogModels: CatalogModel[],
  visibleModels: CatalogModel[],
  cursor: number,
  markedIndices: number[],
): string[] {
  const selected =
    markedIndices.length === 0
      ? visibleModels[cursor] === undefined
        ? []
        : [visibleModels[cursor]]
      : catalogPick(catalogModels, markedIndices);
  return selected.map(({ id }) => id);
}

export function dispatchCatalogSelection(
  mode: CatalogMode,
  indices: number[],
  catalogModels: CatalogModel[],
  importModels: CatalogModel[],
  targetProviderId: string | undefined,
  actions: {
    catalog: (models: CatalogModel[], targetProviderId: string | undefined) => void;
    endpointProvider: (indices: number[]) => void;
    providerTargets: (indices: number[]) => void;
    imported: (models: CatalogModel[]) => void;
  },
): void {
  if (mode === "catalog") {
    actions.catalog(catalogPick(catalogModels, indices), targetProviderId);
    return;
  }
  if (mode === "endpoint-provider") {
    actions.endpointProvider(indices);
    return;
  }
  if (mode === "provider-targets") {
    actions.providerTargets(indices);
    return;
  }
  actions.imported(catalogPick(importModels, indices));
}
