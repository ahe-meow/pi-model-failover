export type ModelAction = (providerId: string, modelId: string) => Promise<void>;

export function selectModel(
  action: ModelAction | undefined,
  providerId: string | undefined,
  modelId: string | undefined,
): Promise<void> | undefined {
  if (action === undefined || providerId === undefined || modelId === undefined) return undefined;
  return action(providerId, modelId);
}

export function selectChain(
  action: ModelAction | undefined,
  chainId: string | undefined,
): Promise<void> | undefined {
  return selectModel(action, "failover", chainId);
}
