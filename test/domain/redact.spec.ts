import { describe, expect, it } from "vitest";
import { redactProvider, redactSecret } from "../../src/domain/redact.js";

const fakeSecret = (suffix: string): string => ["s", "k", "-", suffix].join("");
function expectedRedaction(value: string): string {
  if (value.length < 8) return "…";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

describe("redactSecret (C22)", () => {
  it("keeps 3 head and 4 tail chars", () => {
    const secret = fakeSecret("1234567890abcd");
    expect(redactSecret(secret)).toBe(expectedRedaction(secret));
  });

  it("short values collapse to an ellipsis", () => {
    expect(redactSecret("abcd")).toBe("…");
    expect(redactSecret("abcdefg")).toBe("…");
    expect(redactSecret("abcdefgh")).toBe("abc…efgh");
  });

  it("env references pass through", () => {
    expect(redactSecret("$OPENAI_KEY")).toBe("$OPENAI_KEY");
    expect(redactSecret(`\${OPENAI_KEY}`)).toBe(`\${OPENAI_KEY}`);
  });
});

describe("redactProvider", () => {
  it("redacts apiKey and auth-like headers, keeps others", () => {
    const apiKey = fakeSecret("1234567890abcd");
    const authorization = `Bearer ${fakeSecret("9999999999zzzz")}`;
    const p = redactProvider({
      name: "r",
      baseUrl: "u",
      api: "openai-completions",
      apiKey,
      headers: { Authorization: authorization, "X-Team": "a" },
      models: [],
    });
    expect(p.apiKey).toBe(expectedRedaction(apiKey));
    expect(p.headers).toEqual({ Authorization: expectedRedaction(authorization), "X-Team": "a" });
  });
});
