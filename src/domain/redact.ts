import type { ProviderNode } from "./types.js";

const ENV_REF = /^\$\{?[A-Z_][A-Z0-9_]*\}?$/;
const SECRET_HEADER = /key|token|auth/i;

export function redactSecret(value: string): string {
  if (ENV_REF.test(value)) return value;
  if (value.length < 8) return "…";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export function redactProvider(p: ProviderNode): ProviderNode {
  const result = { ...p };
  if (p.apiKey !== undefined) result.apiKey = redactSecret(p.apiKey);
  if (p.headers) {
    const headers = {} as Record<string, string>;
    for (const [key, value] of Object.entries(p.headers)) {
      if (SECRET_HEADER.test(key)) headers[key] = redactSecret(value);
      else headers[key] = value;
    }
    result.headers = headers;
  }
  return result;
}
