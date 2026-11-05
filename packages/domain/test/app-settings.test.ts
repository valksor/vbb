import { describe, expect, it } from "vitest";
import {
  appSettingsSchema,
  defaultAppSettings,
  managedBranchPrefixSchema,
  MANAGED_BRANCH_PREFIX_MAX_LENGTH,
} from "../src/app-settings.js";
import { refineProviderTurnIdleThresholds } from "../src/provider-turn-idle-settings.fork.js";

describe("managedBranchPrefixSchema", () => {
  it("accepts prefixes that start a valid branch name", () => {
    for (const prefix of ["bb/", "", "sawyer/wt-", "team/bb/", "wip_"]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(true);
    }
  });

  it("rejects prefixes that cannot start a valid branch name", () => {
    for (const prefix of [
      " bb/",
      "bb //",
      "-bb/",
      "/bb/",
      "bb//",
      "bb../",
      "bb:",
      "bb~",
      "bb\\",
      "bb@{",
      ".bb/",
      "a".repeat(MANAGED_BRANCH_PREFIX_MAX_LENGTH + 1),
    ]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(false);
    }
  });

  it("defaults to the bb namespace", () => {
    expect(defaultAppSettings.managedBranchPrefix).toBe("bb/");
    expect(appSettingsSchema.parse(defaultAppSettings)).toEqual(
      defaultAppSettings,
    );
  });
});

describe("provider turn idle watchdog settings", () => {
  it("accepts the minimum thresholds and a boolean enabled flag", () => {
    expect(
      appSettingsSchema.safeParse({
        ...defaultAppSettings,
        providerTurnIdleWatchdogEnabled: false,
        providerTurnIdleNotifyMs: 300_000,
        providerTurnIdleInterruptMs: 300_001,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["providerTurnIdleWatchdogEnabled", "true"],
    ["providerTurnIdleNotifyMs", 299_999],
    ["providerTurnIdleNotifyMs", 300_000.5],
    ["providerTurnIdleNotifyMs", Infinity],
    ["providerTurnIdleNotifyMs", "300000"],
    ["providerTurnIdleInterruptMs", 299_999],
    ["providerTurnIdleInterruptMs", 300_000.5],
    ["providerTurnIdleInterruptMs", Infinity],
    ["providerTurnIdleInterruptMs", "300000"],
  ])("rejects invalid %s values", (key, value) => {
    expect(
      appSettingsSchema.safeParse({ ...defaultAppSettings, [key]: value })
        .success,
    ).toBe(false);
  });

  it.each([
    [300_000, 300_000],
    [300_001, 300_000],
  ])(
    "rejects notify and interrupt thresholds of %i and %i",
    (providerTurnIdleNotifyMs, providerTurnIdleInterruptMs) => {
      expect(
        appSettingsSchema
          .superRefine(refineProviderTurnIdleThresholds)
          .safeParse({
            ...defaultAppSettings,
            providerTurnIdleNotifyMs,
            providerTurnIdleInterruptMs,
          }).success,
      ).toBe(false);
    },
  );
});
