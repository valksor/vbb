import type { QueryClient } from "@tanstack/react-query";
import type { Thread } from "@bb/domain";
import { lookupCachedThread } from "@/lib/cached-thread";
import type { ThreadSelectionPlan } from "./thread-selection-plan";

export function isArchiveRunningStatus(status: Thread["status"]): boolean {
  return status === "starting" || status === "active" || status === "stopping";
}

export function selectionStopsRunningWork(
  queryClient: QueryClient,
  threads: readonly Thread[],
  plan: ThreadSelectionPlan,
): boolean {
  if (threads.some((thread) => isArchiveRunningStatus(thread.status))) {
    return true;
  }
  return [...plan.cascadeThreadIdsByRootId.values()].flat().some((threadId) => {
    const thread = lookupCachedThread(queryClient, threadId);
    return (
      thread !== null &&
      thread.archivedAt === null &&
      isArchiveRunningStatus(thread.status)
    );
  });
}
