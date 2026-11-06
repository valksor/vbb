import type { ThreadQueuedMessage } from "@bb/domain";

export function partitionWaiters<TWait extends { pluginId: string }>(
  request: {
    queuedMessages: ThreadQueuedMessage[];
    pluginSubmission: { pluginId: string } | null | undefined;
  },
  waits: TWait[],
): { waiter: TWait | undefined; additionalWaiters: TWait[] } {
  const heldBy = request.queuedMessages[0]?.waitingOn;
  const ownerId =
    heldBy?.kind === "plugin"
      ? heldBy.pluginId
      : request.pluginSubmission?.pluginId;
  const waiter = waits.find((entry) => entry.pluginId === ownerId) ?? waits[0];
  return {
    waiter,
    additionalWaiters: waits.filter((entry) => entry !== waiter),
  };
}
