import {
  appSettingsSchema,
  refineProviderTurnIdleThresholds,
  type AppSettings,
  type AppSettingsUpdate,
} from "@bb/domain";
import { ApiError } from "../errors.js";

export function resolveGeneralSettingsUpdate(
  current: AppSettings,
  payload: AppSettingsUpdate,
): AppSettings {
  const { showUnhandledProviderEvents, ...settings } = payload;
  const diagnosticValue =
    "showDiagnosticEvents" in settings
      ? settings.showDiagnosticEvents
      : undefined;
  const parsedSettings = appSettingsSchema
    .superRefine(refineProviderTurnIdleThresholds)
    .safeParse({
      ...settings,
      idleProviderSessionTimeoutMinutes:
        settings.idleProviderSessionTimeoutMinutes === undefined
          ? current.idleProviderSessionTimeoutMinutes
          : settings.idleProviderSessionTimeoutMinutes,
      allowFastServiceTier:
        settings.allowFastServiceTier ?? current.allowFastServiceTier,
      telemetryEnabled: settings.telemetryEnabled ?? current.telemetryEnabled,
      terminalCopyOnSelect:
        settings.terminalCopyOnSelect ?? current.terminalCopyOnSelect,
      keepHistoryAfterContextClear:
        settings.keepHistoryAfterContextClear ??
        current.keepHistoryAfterContextClear,
      summarizeShellCommands:
        settings.summarizeShellCommands ?? current.summarizeShellCommands,
      confirmThreadArchive:
        settings.confirmThreadArchive ?? current.confirmThreadArchive,
      earlyAdopter: settings.earlyAdopter ?? current.earlyAdopter,
      onboardingCompletedAt:
        settings.onboardingCompletedAt === undefined
          ? current.onboardingCompletedAt
          : settings.onboardingCompletedAt,
      providerTurnIdleWatchdogEnabled:
        settings.providerTurnIdleWatchdogEnabled === undefined
          ? current.providerTurnIdleWatchdogEnabled
          : settings.providerTurnIdleWatchdogEnabled,
      providerTurnIdleNotifyMs:
        settings.providerTurnIdleNotifyMs === undefined
          ? current.providerTurnIdleNotifyMs
          : settings.providerTurnIdleNotifyMs,
      providerTurnIdleInterruptMs:
        settings.providerTurnIdleInterruptMs === undefined
          ? current.providerTurnIdleInterruptMs
          : settings.providerTurnIdleInterruptMs,
      showDiagnosticEvents:
        diagnosticValue === undefined ||
        (showUnhandledProviderEvents !== undefined &&
          diagnosticValue === current.showDiagnosticEvents)
          ? showUnhandledProviderEvents
          : diagnosticValue,
    });
  if (!parsedSettings.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsedSettings.error.issues[0]?.message ?? "Invalid general settings",
    );
  }
  return parsedSettings.data;
}
