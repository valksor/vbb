import { getAppSettings } from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import { expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

it("validates merged watchdog thresholds without changing stored settings", async () => {
  await withTestHarness(async (harness) => {
    const put = (settings: object) =>
      harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
    const configured = {
      ...defaultAppSettings,
      providerTurnIdleNotifyMs: 10 * 60_000,
      providerTurnIdleInterruptMs: 20 * 60_000,
    };
    expect((await put(configured)).status).toBe(200);
    const { providerTurnIdleInterruptMs, ...oneFieldUpdate } = configured;
    const response = await put({
      ...oneFieldUpdate,
      providerTurnIdleNotifyMs: 30 * 60_000,
    });

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      code: "invalid_request",
      message: "providerTurnIdleInterruptMs (1200000) must be greater than providerTurnIdleNotifyMs (1800000)",
    });
    expect(getAppSettings(harness.db)).toEqual(configured);
  });
});

it("preserves watchdog settings for legacy payloads and accepts valid updates", async () => {
  await withTestHarness(async (harness) => {
    const put = (settings: object) =>
      harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
    const configured = {
      ...defaultAppSettings,
      providerTurnIdleWatchdogEnabled: false,
      providerTurnIdleNotifyMs: 600_000,
      providerTurnIdleInterruptMs: 1_200_000,
    };
    expect((await put(configured)).status).toBe(200);
    const {
      providerTurnIdleWatchdogEnabled,
      providerTurnIdleNotifyMs,
      providerTurnIdleInterruptMs,
      ...legacyPayload
    } = defaultAppSettings;
    expect(providerTurnIdleWatchdogEnabled).toBe(true);
    expect(providerTurnIdleNotifyMs).toBe(21_600_000);
    expect(providerTurnIdleInterruptMs).toBe(43_200_000);

    expect((await put(legacyPayload)).status).toBe(200);
    expect(getAppSettings(harness.db)).toEqual(configured);

    const updated = {
      ...legacyPayload,
      providerTurnIdleWatchdogEnabled: true,
      providerTurnIdleNotifyMs: 900_000,
      providerTurnIdleInterruptMs: 1_800_000,
    };
    expect((await put(updated)).status).toBe(200);
    expect(getAppSettings(harness.db)).toEqual(updated);
  });
});
