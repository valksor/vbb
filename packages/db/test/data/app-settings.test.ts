import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  getAppKeybindingOverrides,
  getAppSettings,
  setAppKeybindingOverrides,
  setAppSettings,
  type DbConnection,
} from "../../src/index.js";
import { createMigratedConnection } from "../../src/testing.js";

describe("app settings data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => {
    db.$client.close();
  });

  it("defaults archive confirmation to enabled and persists opting out", () => {
    expect(getAppSettings(db).confirmThreadArchive).toBe(true);
    setAppSettings(db, { ...defaultAppSettings, confirmThreadArchive: false });
    expect(getAppSettings(db).confirmThreadArchive).toBe(false);
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

  it("preserves the legacy diagnostic preference and lets the new preference override it", () => {
    db.$client.exec(
      "INSERT INTO app_settings_values (key, value, updated_at) VALUES ('showUnhandledProviderEvents', 'true', 1)",
    );
    expect(getAppSettings(db).showDiagnosticEvents).toBe(true);
    db.$client.exec(
      "INSERT INTO app_settings_values (key, value, updated_at) VALUES ('showDiagnosticEvents', 'false', 2)",
    );
    expect(getAppSettings(db).showDiagnosticEvents).toBe(false);
    setAppSettings(db, { ...defaultAppSettings, showDiagnosticEvents: true });
    expect(getAppSettings(db).showDiagnosticEvents).toBe(true);
    expect(
      db.$client
        .prepare(
          "SELECT key FROM app_settings_values WHERE key = 'showUnhandledProviderEvents'",
        )
        .get(),
    ).toBeUndefined();
  });

  it("defaults terminal copy-on-select to enabled and persists opting out", () => {
    expect(getAppSettings(db).terminalCopyOnSelect).toBe(true);
    setAppSettings(db, { ...defaultAppSettings, terminalCopyOnSelect: false });
    expect(getAppSettings(db).terminalCopyOnSelect).toBe(false);
    db.$client.exec("UPDATE app_settings_values SET value = '\"invalid\"' WHERE key = 'terminalCopyOnSelect'");
    expect(getAppSettings(db).terminalCopyOnSelect).toBe(true);
  });

  it("persists keyboard overrides without clobbering general settings", () => {
    const overrides = [
      { command: "thread.new" as const, shortcut: null },
    ];
    setAppSettings(db, {
      ...defaultAppSettings,
      showKeyboardHints: false,
      steerActiveThreadOnEnter: true,
      providerOrder: ["pi"],
      defaultProviderId: "pi",
    });
    setAppKeybindingOverrides(db, overrides);

    expect(getAppSettings(db)).toEqual({
      ...defaultAppSettings,
      showKeyboardHints: false,
      steerActiveThreadOnEnter: true,
      providerOrder: ["pi"],
      defaultProviderId: "pi",
    });
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);

    setAppSettings(db, defaultAppSettings);
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);
  });

  it("ignores retired keys and falls back per key on an unreadable value", () => {
    setAppSettings(db, {
      ...defaultAppSettings,
      steerActiveThreadOnEnter: true,
    });
    db.$client.exec(`
      INSERT INTO app_settings_values (key, value, updated_at)
      VALUES ('retiredPreference', 'true', 1)
      ON CONFLICT (key) DO UPDATE SET value = 'true';
      UPDATE app_settings_values
      SET value = '"yes"'
      WHERE key = 'showKeyboardHints';
      UPDATE app_settings_values
      SET value = 'not json'
      WHERE key = 'providerOrder';
    `);

    expect(getAppSettings(db)).toEqual({
      ...defaultAppSettings,
      steerActiveThreadOnEnter: true,
    });
  });
});
