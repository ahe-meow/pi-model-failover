import type { ServerQualityOverride, ServerQualitySettings } from "./serverQuality.js";

export type ApiType =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";
export type TargetRef = `${string}/${string}`;
export type ErrorHandlingMode = "smart" | "switch" | "retry";
export type FailureClass = "cooldown" | "persistent" | "compat-retry" | "server-quality";
export type FailoverReason =
  | `http-${number}`
  | "network"
  | "ttft-timeout"
  | "no-progress"
  | "persistent"
  | "manual";

export const REASONING_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];
export type ReasoningEffort = "inherit" | ReasoningLevel;

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  switch (value) {
    case "off":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
    case "inherit":
      return value;
    case "minimal":
      return "low";
    default:
      return "inherit";
  }
}

export function normalizeThinkingLevelMap(
  reasoning: boolean,
  thinkingLevelMap?: Record<string, string | null>,
): Record<string, string | null> | undefined {
  if (thinkingLevelMap === undefined) {
    return reasoning ? { minimal: null, xhigh: "xhigh", max: "max" } : undefined;
  }
  if (!reasoning) return { ...thinkingLevelMap };
  return { ...thinkingLevelMap, minimal: null };
}

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
  reasoningEffort: ReasoningEffort;
  modelParameters: Record<string, unknown>;
  noProgressTimeoutSeconds: number;
  ttftTimeoutSeconds: number;
  serverQuality: ServerQualitySettings;
}
export interface Target extends Omit<Partial<TargetSettings>, "serverQuality"> {
  provider: string;
  modelId: string;
  serverQuality?: ServerQualityOverride;
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
export interface FailoverErrorDetails {
  status?: number;
  code?: string;
  body?: string;
}
export interface FailoverEvent {
  ts: string;
  sessionId: string;
  requestSeq: number;
  from: TargetRef;
  to: TargetRef | null;
  reason: FailoverReason;
  elapsedMs: number;
  error?: FailoverErrorDetails;
}

export interface ModelNode {
  id: string;
  name?: string;
  api?: ApiType;
  baseUrl?: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null>;
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
  baseUrl?: string;
  api?: ApiType;
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  modelOverrides?: Record<string, unknown>;
  models: ModelNode[];
  piModelFailover?: { group: string | null; costMultiplier: number };
  piModelManager?: { managed: boolean };
  [k: string]: unknown;
}
export type ModelsJson = { providers: Record<string, ProviderNode>; [k: string]: unknown };
