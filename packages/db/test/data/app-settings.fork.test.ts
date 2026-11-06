import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  getAppSettings,
  setAppSettings,
  type DbConnection,
} from "../../src/index.js";
import { createMigratedConnection } from "../../src/testing.js";

describe("fork app settings data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => {
    db.$client.close();
  });

  it("uses watchdog defaults when no watchdog values are stored", () => {
    expect(
      db.$client
        .prepare(
          "SELECT key FROM app_settings_values WHERE key IN (?, ?, ?)",
        )
        .all(
          "providerTurnIdleWatchdogEnabled",
          "providerTurnIdleNotifyMs",
          "providerTurnIdleInterruptMs",
        ),
    ).toEqual([]);
    expect(getAppSettings(db)).toMatchObject({
      providerTurnIdleWatchdogEnabled: true,
      providerTurnIdleNotifyMs: 21_600_000,
      providerTurnIdleInterruptMs: 43_200_000,
    });
  });

  it.each([
    ["malformed JSON", "providerTurnIdleNotifyMs", "not json"],
    [
      "a wrong enabled scalar type",
      "providerTurnIdleWatchdogEnabled",
      '"true"',
    ],
    ["a wrong notify scalar type", "providerTurnIdleNotifyMs", "true"],
    ["a wrong interrupt scalar type", "providerTurnIdleInterruptMs", "null"],
    ["a below-minimum scalar value", "providerTurnIdleInterruptMs", "299999"],
    ["a fractional scalar value", "providerTurnIdleNotifyMs", "300000.5"],
  ])("rejects a stored watchdog value with %s", (_caseName, key, value) => {
    db.$client
      .prepare(
        "INSERT INTO app_settings_values (key, value, updated_at) VALUES (?, ?, ?)",
      )
      .run(key, value, 1);

    expect(() => getAppSettings(db)).toThrow();
  });

  it("does not change stored settings when watchdog thresholds are invalid", () => {
    const configured = {
      ...defaultAppSettings,
      providerTurnIdleWatchdogEnabled: false,
      providerTurnIdleNotifyMs: 600_000,
      providerTurnIdleInterruptMs: 1_200_000,
    };
    setAppSettings(db, configured);

    expect(() =>
      setAppSettings(db, {
        ...configured,
        providerTurnIdleNotifyMs: configured.providerTurnIdleInterruptMs,
      }),
    ).toThrow(
      "providerTurnIdleInterruptMs (1200000) must be greater than providerTurnIdleNotifyMs (1200000)",
    );
    expect(getAppSettings(db)).toEqual(configured);
  });
});
