import type { ProviderNode } from "./types.js";

const ENV_REF = /^\$\{?[A-Z_][A-Z0-9_]*\}?$/;
const SECRET_HEADER = /key|token|auth/i;
const SECRET_ASSIGNMENT =
  /(["']?(?:api[_-]?key|apikey|authorization|auth|token|secret|bearer)["']?\s*[:=]\s*)(["']?)((?:bearer|basic|token)\s+)?([^\s"',}]+)/gi;
const BARE_TOKEN = /\bsk-[A-Za-z0-9_-]{8,}/g;

export function redactFailureBody(body: string): string {
  return body
    .replace(
      SECRET_ASSIGNMENT,
      (_match, prefix: string, quote: string, scheme: string | undefined, value: string) =>
        `${prefix}${quote}${scheme ?? ""}${redactSecret(value)}`,
    )
    .replace(BARE_TOKEN, (token) => redactSecret(token));
}

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
