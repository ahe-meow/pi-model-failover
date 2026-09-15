import { virtualModelNode } from "../../../domain/chains.js";
import type { Chain, ModelsJson, TargetRef, TargetState } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import type { Row } from "../../primitives/scrollList.js";
import type { TableColumn } from "../../primitives/table.js";
import { filterRows } from "../../primitives/textFilter.js";
import { theme } from "../../primitives/theme.js";
import { chainStatus, firstTargetRef, targetRef, targetStatus } from "./support.js";

export function chainDetailHeader(chain: Chain, models: ModelsJson): string {
  const virtual = virtualModelNode(chain, models);
  if (virtual === null)
    return S.chains.detailHeader(chain.id, S.chains.notRegistered, S.chains.notRegistered);
  return S.chains.detailHeader(
    chain.id,
    S.chains.virtualId(chain.id),
    S.chains.virtualDetails(
      virtual.contextWindow,
      virtual.reasoning ? S.chains.reasoning.yes : S.chains.reasoning.no,
      virtual.input.join(","),
    ),
  );
}

export function filteredChainRows(
  chains: readonly Chain[],
  states: Record<TargetRef, TargetState>,
  now: number,
  query: string,
): { rows: Row[]; chains: Chain[] } {
  const filtered = filterRows(
    chains,
    (chain) => {
      const cells = [
        chain.id,
        String(chain.targets.length),
        firstTargetRef(chain.targets),
        theme.status(chainStatus(chain.targets, states, now)),
      ];
      return { text: cells.join("  "), cells };
    },
    query,
  );
  return { rows: filtered.map(({ row }) => row), chains: filtered.map(({ item }) => item) };
}

const TARGET_MIN_WIDTH = 24;

export const targetColumns = (): TableColumn[] => [
  { header: S.chains.targetLabels.index },
  { header: S.chains.targetLabels.target, minWidth: TARGET_MIN_WIDTH },
  { header: S.chains.targetLabels.multiplier },
  { header: S.chains.targetLabels.status },
];

export function filteredTargetRows(
  chain: Chain,
  models: ModelsJson,
  states: Record<TargetRef, TargetState>,
  now: number,
  query: string,
): { rows: Row[]; indices: number[] } {
  const filtered = filterRows(
    chain.targets,
    (target, index) => {
      const multiplier = models.providers[target.provider]?.piModelFailover?.costMultiplier ?? 1;
      const status = theme.status(targetStatus(states[targetRef(target)], now));
      const cells = [String(index + 1), targetRef(target), `${multiplier.toFixed(2)}x`, status];
      return { text: cells.join("  "), cells };
    },
    query,
  );
  return {
    rows: filtered.map(({ row }) => row),
    indices: filtered.map(({ index }) => index),
  };
}
