import type { FailoverReason, FailureClass } from "./types.js";

export interface FailureInput {
  status?: number;
  code?: string;
  body?: string;
  timer?: "ttft" | "no-progress";
  sentParams: string[];
}

type Classification = {
  cls: FailureClass;
  reason: FailoverReason;
  offendingParam?: string;
};

const PERSISTENT_STATUSES = new Set([401, 402, 403, 404]);
const NETWORK_CODES = new Set(["ECONNRESET", "ENOTFOUND", "ETIMEDOUT"]);
const COMPATIBILITY_PARAMS = new Set([
  "reasoning_effort",
  "temperature",
  "max_completion_tokens",
  "thinking",
]);
const QUOTA_OR_BILLING = /quota|insufficient_quota|billing/i;
const PARAMETER_BOUNDARY = /[^a-z0-9_]/i;

const httpReason = (status: number): FailoverReason => `http-${status}`;

function namesParameter(body: string, parameter: string): boolean {
  const lowerBody = body.toLowerCase();
  const lowerParameter = parameter.toLowerCase();
  let position = lowerBody.indexOf(lowerParameter);

  while (position !== -1) {
    const before = position === 0 ? undefined : lowerBody[position - 1];
    const afterPosition = position + lowerParameter.length;
    const after = afterPosition === lowerBody.length ? undefined : lowerBody[afterPosition];
    if (
      (before === undefined || PARAMETER_BOUNDARY.test(before)) &&
      (after === undefined || PARAMETER_BOUNDARY.test(after))
    ) {
      return true;
    }
    position = lowerBody.indexOf(lowerParameter, position + 1);
  }

  return false;
}

export function classify(e: FailureInput): Classification {
  const { body, status } = e;

  if (e.timer === "ttft") return { cls: "cooldown", reason: "ttft-timeout" };
  if (e.timer === "no-progress") return { cls: "cooldown", reason: "no-progress" };

  if (status !== undefined && PERSISTENT_STATUSES.has(status)) {
    return { cls: "persistent", reason: httpReason(status) };
  }
  if (status === 429 && QUOTA_OR_BILLING.test(body ?? "")) {
    return { cls: "persistent", reason: httpReason(status) };
  }

  if (status === 400 && body !== undefined) {
    const offendingParam = e.sentParams.find(
      (parameter) =>
        COMPATIBILITY_PARAMS.has(parameter.toLowerCase()) && namesParameter(body, parameter),
    );
    if (offendingParam !== undefined) {
      return { cls: "compat-retry", reason: "http-400", offendingParam };
    }
  }

  if (status === 429) {
    return { cls: "cooldown", reason: httpReason(status) };
  }
  if (status !== undefined && status >= 500 && status <= 599) {
    return { cls: "cooldown", reason: httpReason(status) };
  }
  if (e.code !== undefined && NETWORK_CODES.has(e.code)) {
    return { cls: "cooldown", reason: "network" };
  }

  return {
    cls: "cooldown",
    reason: status === undefined ? "network" : httpReason(status),
  };
}
