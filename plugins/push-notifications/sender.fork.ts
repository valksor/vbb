import type {
  BbPluginApi,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";

type ThreadResponse = PluginThreadEventPayloads["thread.idle"]["thread"];

const RUNNING_CHILD_STATUSES: ReadonlySet<ThreadResponse["status"]> = new Set([
  "starting",
  "active",
  "stopping",
]);

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

export async function hasRunningChild(
  bb: BbPluginApi,
  threadId: string,
): Promise<boolean> {
  try {
    const children = await bb.sdk.threads.list({
      parentThreadId: threadId,
      archived: false,
    });
    return children.some(
      (child) =>
        RUNNING_CHILD_STATUSES.has(child.status) ||
        (child.status === "pending" && child.queuedWork === "waiting"),
    );
  } catch (error: unknown) {
    bb.log.warn(
      `Could not list child threads of ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
