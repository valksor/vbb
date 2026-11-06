import { useCallback } from "react";
import type { Thread, ThreadListEntry } from "@bb/domain";
import { appToast } from "@/components/ui/app-toast";
import type { ThreadArchiveDialogTarget } from "@/components/dialogs/ThreadArchiveDialog";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { isArchiveRunningStatus } from "@/lib/thread-selection-plan.fork";

interface EnvironmentArchiveFlowOptions {
  archiveEnvironmentMutateAsync: (
    environmentId: string,
  ) => Promise<{ archivedThreadIds: readonly string[] }>;
  archiveEnvironmentThreads: (environmentId: string) => Promise<void>;
  closeArchiveDialog: () => void;
  openArchiveDialog: (
    request: ThreadArchiveDialogTarget & { roots: readonly Thread[] },
  ) => void;
  presentArchivedThreads: (
    archivedThreadIds: readonly string[],
    toastId: string,
    singleThread: Thread | null,
    stoppedWork: boolean,
  ) => void;
  threadEntries: ReadonlyMap<string, ThreadListEntry>;
}

export function useEnvironmentArchiveFlow({
  archiveEnvironmentMutateAsync,
  archiveEnvironmentThreads,
  closeArchiveDialog,
  openArchiveDialog,
  presentArchivedThreads,
  threadEntries,
}: EnvironmentArchiveFlowOptions) {
  const archiveEnvironmentFromDialog = useCallback(
    async (environmentId: string, stoppedWork: boolean) => {
      try {
        const response = await archiveEnvironmentMutateAsync(environmentId);
        closeArchiveDialog();
        if (response.archivedThreadIds.length === 0) {
          appToast.message("No threads left to archive.");
          return;
        }
        presentArchivedThreads(
          response.archivedThreadIds,
          `environment-archived-${environmentId}`,
          null,
          stoppedWork,
        );
      } catch (error) {
        closeArchiveDialog();
        showMutationErrorToast({
          error,
          fallbackMessage: "Failed to archive environment threads",
        });
      }
    },
    [archiveEnvironmentMutateAsync, closeArchiveDialog, presentArchivedThreads],
  );

  const confirmArchiveEnvironmentThreads = useCallback(
    async (environmentId: string) => {
      const entries = [...threadEntries.values()].filter(
        (entry) =>
          entry.environmentId === environmentId && entry.archivedAt === null,
      );
      if (entries.some((entry) => isArchiveRunningStatus(entry.status))) {
        openArchiveDialog({
          threads: entries,
          roots: [],
          childThreadCount: 0,
          stopsRunningWork: true,
          environmentId,
        });
        return;
      }
      await archiveEnvironmentThreads(environmentId);
    },
    [archiveEnvironmentThreads, openArchiveDialog, threadEntries],
  );

  return { archiveEnvironmentFromDialog, confirmArchiveEnvironmentThreads };
}
