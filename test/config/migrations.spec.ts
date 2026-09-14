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
});
