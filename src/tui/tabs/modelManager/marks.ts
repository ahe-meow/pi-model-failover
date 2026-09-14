import type { ModelNode, ProviderNode } from "../../../domain/types.js";
import type { ScrollList } from "../../primitives/scrollList.js";

export function syncModelMarks(
  visibleModels: readonly ModelNode[],
  list: ScrollList,
  markedIds: Set<string>,
): void {
  const marked = new Set(list.markedIndices());
  for (const [index, model] of visibleModels.entries()) {
    if (marked.has(index)) markedIds.add(model.id);
    else markedIds.delete(model.id);
  }
}

export function markedModelIds(
  provider: ProviderNode | undefined,
  markedIds: ReadonlySet<string>,
): string[] {
  return provider?.models.flatMap(({ id }) => (markedIds.has(id) ? [id] : [])) ?? [];
}
