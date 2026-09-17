import { describe, expect, it } from "vitest";
import {
  CONFIG_VERSION,
  configMigrations,
  STATE_VERSION,
  stateMigrations,
} from "../../src/config/migrations.js";

describe("migration tables", () => {
  it("cover every version below current", () => {
    for (let v = 1; v < CONFIG_VERSION; v++) {
      expect(configMigrations[v]).toBeTypeOf("function");
    }
    for (let v = 1; v < STATE_VERSION; v++) {
      expect(stateMigrations[v]).toBeTypeOf("function");
    }
  });

  it("migrates v1 Server Quality fields without dropping unknown data", () => {
    const migrate = configMigrations[1];
    const migrated = migrate?.({
      version: 1,
      settings: {
        ttftAction: "abort",
        unknownSetting: { keep: true },
      },
      catalog: [],
      keyGroups: [],
      chains: [
        {
          id: "c",
          name: "C",
          unknownChain: "keep",
          targets: [
            {
              provider: "p",
              modelId: "m",
              ttftAction: "cooldown-only",
              unknownTarget: 1,
            },
          ],
        },
      ],
      unknownRoot: [1],
    });

    expect(migrated).toEqual({
      version: 2,
      settings: {
        serverQuality: { enabled: true, ttft: true, noProgress: true },
        unknownSetting: { keep: true },
      },
      catalog: [],
      keyGroups: [],
      chains: [
        {
          id: "c",
          name: "C",
          unknownChain: "keep",
          targets: [{ provider: "p", modelId: "m", unknownTarget: 1 }],
        },
      ],
      unknownRoot: [1],
    });
  });

  it("leaves explicit false values in a v2 payload unchanged", () => {
    const migrate = configMigrations[1];
    const payload = {
      version: 2,
      settings: {
        serverQuality: { enabled: false, ttft: false, noProgress: true },
      },
    };
    expect(migrate?.(payload)).toEqual(payload);
  });
});
