export type ApiType =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";
export type TargetRef = `${string}/${string}`;
export type ErrorHandlingMode = "smart" | "switch" | "retry";
export type TtftAction = "cooldown-only" | "abort";
export type FailureClass = "cooldown" | "persistent" | "compat-retry";
export type FailoverReason =
  | `http-${number}`
  | "network"
  | "ttft-timeout"
  | "no-progress"
  | "persistent"
  | "manual";

export interface CatalogModel {
  id: string;
  name?: string;
  reasoning: boolean;
  vision: boolean;
  contextWindow: number;
  maxTokens: number;
  defaults: Record<string, unknown>;
}
export interface TargetSettings {
  errorHandlingMode: ErrorHandlingMode;
  maxRetries: number;
  reasoningEffort: "inherit" | "minimal" | "low" | "medium" | "high";
  modelParameters: Record<string, unknown>;
  noProgressTimeoutSeconds: number;
  ttftTimeoutSeconds: number;
  ttftAction: TtftAction;
}
export interface Target extends Partial<TargetSettings> {
  provider: string;
  modelId: string;
}
export interface Chain {
  id: string;
  name: string;
  targets: Target[];
}
export interface KeyGroup {
  id: string;
  prefix: string;
  template: { baseUrl: string; api: ApiType; headers: Record<string, string> };
  createdAt: string;
}
export interface Settings extends TargetSettings {
  listRows: number;
}
export interface TargetState {
  consecutiveFailures: number;
  cooldownLevel: number;
  cooldownUntil: string | null;
  manualRecovery: boolean;
  lastFailure: { ts: string; reason: FailoverReason } | null;
}
export interface FailoverEvent {
  ts: string;
  sessionId: string;
  requestSeq: number;
  from: TargetRef;
  to: TargetRef | null;
  reason: FailoverReason;
  elapsedMs: number;
}

export interface ModelNode {
  id: string;
  name?: string;
  api?: ApiType;
  baseUrl?: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string>;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  [k: string]: unknown;
}
export interface ProviderNode {
  name: string;
  baseUrl: string;
  api: ApiType;
  apiKey?: string;
  authHeader?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  modelOverrides?: Record<string, unknown>;
  models: ModelNode[];
  piModelFailover?: { group: string | null; costMultiplier: number };
  piModelManager?: { managed: boolean };
  [k: string]: unknown;
}
export type ModelsJson = { providers: Record<string, ProviderNode>; [k: string]: unknown };
