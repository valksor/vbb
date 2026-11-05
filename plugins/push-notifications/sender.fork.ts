import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";

function describeApproxDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function turnWatchdogMessage({
  elapsedMs,
  action,
}: PluginThreadEventPayloads["experimental_thread.turnWatchdog"]): string {
  const duration = describeApproxDuration(elapsedMs);
  return action === "interrupt"
    ? `bb stopped a stalled turn after ${duration}`
    : `Turn stalled — no activity for ${duration}`;
}
