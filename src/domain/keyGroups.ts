import type { KeyGroup, ProviderNode } from "./types.js";

export interface KeyEntry {
  key: string;
  multiplier?: number;
}

export function nextFreeSuffix(existing: string[], prefix: string): number {
  const occupied = new Set(existing);
  let suffix = 1;
  while (occupied.has(`${prefix}-${suffix}`)) suffix++;
  return suffix;
}

export function createKeyGroup(input: {
  prefix: string;
  template: KeyGroup["template"];
  keys: KeyEntry[];
  now: string;
  id: string;
  existingIds?: readonly string[];
}): {
  group: KeyGroup;
  providers: Record<string, ProviderNode>;
} {
  if (input.keys.length === 0) throw new Error("keys must not be empty");

  for (const entry of input.keys) {
    const multiplier = entry.multiplier ?? 1;
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error("multiplier must be positive");
    }
  }

  const occupied = new Set(input.existingIds ?? []);
  let suffix = nextFreeSuffix([...occupied], input.prefix);
  const providers: Record<string, ProviderNode> = {};

  for (const entry of input.keys) {
    while (occupied.has(`${input.prefix}-${suffix}`)) suffix++;
    const id = `${input.prefix}-${suffix++}`;
    const multiplier = entry.multiplier ?? 1;
    providers[id] = {
      name: id,
      ...structuredClone(input.template),
      apiKey: entry.key,
      models: [],
      piModelFailover: { group: input.id, costMultiplier: multiplier },
    };
    occupied.add(id);
  }

  return {
    group: {
      id: input.id,
      prefix: input.prefix,
      template: structuredClone(input.template),
      createdAt: input.now,
    },
    providers,
  };
}
