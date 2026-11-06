import { expectTypeOf, it } from "vitest";
import type { BbSdk } from "@bb/sdk";

type SystemUpdateGeneralSettingsArgs = Parameters<
  BbSdk["system"]["updateGeneralSettings"]
>[0];

it("exposes watchdog settings through general settings updates", () => {
  expectTypeOf<
    SystemUpdateGeneralSettingsArgs["providerTurnIdleWatchdogEnabled"]
  >().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<
    SystemUpdateGeneralSettingsArgs["providerTurnIdleNotifyMs"]
  >().toEqualTypeOf<number | undefined>();
  expectTypeOf<
    SystemUpdateGeneralSettingsArgs["providerTurnIdleInterruptMs"]
  >().toEqualTypeOf<number | undefined>();
});
