import { resolveTargetSettings, virtualModelNode } from "../../../domain/chains.js";
import type { Chain, ModelsJson, Settings, TargetRef, TargetState } from "../../../domain/types.js";
import { S } from "../../../strings.js";
import type { Row } from "../../primitives/scrollList.js";
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

export function filteredTargetRows(
  chain: Chain,
  models: ModelsJson,
  settings: Settings,
  states: Record<TargetRef, TargetState>,
  now: number,
  query: string,
): { rows: Row[]; indices: number[] } {
  const filtered = filterRows(
    chain.targets,
    (target, index) => {
      const resolved = resolveTargetSettings(target, settings);
      const multiplier = models.providers[target.provider]?.piModelFailover?.costMultiplier ?? 1;
      const status = theme.status(targetStatus(states[targetRef(target)], now));
      const cells = [
        String(index + 1),
        targetRef(target),
        `${multiplier.toFixed(2)}x`,
        resolved.errorHandlingMode,
        `r${resolved.maxRetries}`,
        `ttft${resolved.ttftTimeoutSeconds}/${resolved.ttftAction}`,
        status,
      ];
      return { text: cells.join("  "), cells };
    },
    query,
  );
  return {
    rows: filtered.map(({ row }) => row),
    indices: filtered.map(({ index }) => index),
  };
}
