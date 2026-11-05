import { z } from "zod";

export const PROVIDER_TURN_IDLE_WATCHDOG_MIN_MS = 5 * 60_000;
export const DEFAULT_PROVIDER_TURN_IDLE_NOTIFY_MS = 6 * 60 * 60_000;
export const DEFAULT_PROVIDER_TURN_IDLE_INTERRUPT_MS = 12 * 60 * 60_000;

export const providerTurnIdleSettingsShape = {
  providerTurnIdleWatchdogEnabled: z.boolean(),
  providerTurnIdleNotifyMs: z
    .number()
    .int()
    .finite()
    .min(PROVIDER_TURN_IDLE_WATCHDOG_MIN_MS),
  providerTurnIdleInterruptMs: z
    .number()
    .int()
    .finite()
    .min(PROVIDER_TURN_IDLE_WATCHDOG_MIN_MS),
};

export const defaultProviderTurnIdleSettings = {
  providerTurnIdleWatchdogEnabled: true,
  providerTurnIdleNotifyMs: DEFAULT_PROVIDER_TURN_IDLE_NOTIFY_MS,
  providerTurnIdleInterruptMs: DEFAULT_PROVIDER_TURN_IDLE_INTERRUPT_MS,
};

export function refineProviderTurnIdleThresholds(
  value: {
    providerTurnIdleInterruptMs: number;
    providerTurnIdleNotifyMs: number;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.providerTurnIdleInterruptMs <= value.providerTurnIdleNotifyMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providerTurnIdleInterruptMs"],
      message: `providerTurnIdleInterruptMs (${value.providerTurnIdleInterruptMs}) must be greater than providerTurnIdleNotifyMs (${value.providerTurnIdleNotifyMs})`,
    });
  }
}
