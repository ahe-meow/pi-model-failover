import { describe, expect, it } from "vitest";
import { classify } from "../../src/domain/failureClass.js";

describe("classify", () => {
  it.each([
    [{ status: 401 }, "persistent", "persistent"],
    [{ status: 403 }, "persistent", "persistent"],
    [{ status: 404 }, "persistent", "persistent"],
    [{ status: 402 }, "persistent", "persistent"],
    [{ status: 429, body: "QUOTA exhausted" }, "persistent", "persistent"],
    [{ status: 429, body: "insufficient_QUOTA" }, "persistent", "persistent"],
    [{ status: 429, body: "BILLING account disabled" }, "persistent", "persistent"],
    [{ status: 429 }, "cooldown", "http-429"],
    [{ status: 500 }, "cooldown", "http-500"],
    [{ status: 503 }, "cooldown", "http-503"],
    [{ status: 599 }, "cooldown", "http-599"],
    [{ code: "ECONNRESET" }, "cooldown", "network"],
    [{ code: "ENOTFOUND" }, "cooldown", "network"],
    [{ code: "ETIMEDOUT" }, "cooldown", "network"],
    [{ timer: "ttft" }, "cooldown", "ttft-timeout"],
    [{ timer: "no-progress" }, "cooldown", "no-progress"],
    [{ status: 418 }, "cooldown", "http-418"],
    [{}, "cooldown", "network"],
  ] as const)("classifies %j", (input, cls, reason) => {
    expect(classify({ sentParams: [], ...input })).toMatchObject({ cls, reason });
  });

  it("C15: extracts a sent compatibility parameter", () => {
    expect(
      classify({
        status: 400,
        body: "Unknown parameter: REASONING_EFFORT",
        sentParams: ["reasoning_effort"],
      }),
    ).toEqual({ cls: "compat-retry", reason: "http-400", offendingParam: "reasoning_effort" });
  });

  it.each(["reasoning_effort", "temperature", "max_completion_tokens", "thinking"])(
    "C15: recognizes the sent parameter %s",
    (param) => {
      expect(
        classify({
          status: 400,
          body: `unsupported parameter '${param}'`,
          sentParams: [param],
        }),
      ).toEqual({ cls: "compat-retry", reason: "http-400", offendingParam: param });
    },
  );

  it("C15: does not classify an unsent parameter as compatibility retry", () => {
    expect(
      classify({
        status: 400,
        body: "Unknown parameter: temperature",
        sentParams: [],
      }).cls,
    ).toBe("cooldown");
  });

  it("C15: does not match a parameter embedded in a larger name", () => {
    expect(
      classify({
        status: 400,
        body: "Unknown parameter: temperature_scale",
        sentParams: ["temperature"],
      }),
    ).toEqual({ cls: "cooldown", reason: "http-400" });
  });

  it("applies timer precedence over persistent and compatibility signals", () => {
    expect(
      classify({
        timer: "ttft",
        status: 401,
        body: "Unknown parameter: temperature quota",
        sentParams: ["temperature"],
      }),
    ).toEqual({ cls: "cooldown", reason: "ttft-timeout" });
  });

  it("applies persistent status precedence over network codes", () => {
    expect(classify({ status: 401, code: "ECONNRESET", sentParams: [] })).toEqual({
      cls: "persistent",
      reason: "persistent",
    });
  });
});
