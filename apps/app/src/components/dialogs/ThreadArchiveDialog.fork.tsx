import { DialogDescription, DialogTitle } from "@bb/shared-ui/dialog";
import { formatChildThreadCount } from "@/lib/child-thread-copy";
import type { ThreadArchiveDialogTarget } from "./ThreadArchiveDialog";

interface ArchiveDialogCopyProps {
  target: ThreadArchiveDialogTarget;
}

export function ArchiveDialogCopy({ target }: ArchiveDialogCopyProps) {
  const { childThreadCount, environmentId, stopsRunningWork, threads } = target;
  const single = threads.length === 1;

  return (
    <>
      <DialogTitle>
        {environmentId !== undefined
          ? "Archive all threads in this environment?"
          : single
            ? "Archive thread?"
            : `Archive ${threads.length} threads?`}
      </DialogTitle>
      <DialogDescription>
        {stopsRunningWork ? "This will stop current work. " : null}
        {environmentId === undefined && childThreadCount > 0 ? (
          <>
            {single ? "Its" : "Their"}{" "}
            <span className="font-semibold">
              {formatChildThreadCount(childThreadCount)}
            </span>{" "}
            will be archived too.{" "}
          </>
        ) : null}
        {environmentId === undefined
          ? "Archived threads stay available and can be unarchived."
          : "Child threads are archived too. All threads in this environment stay available and can be unarchived."}
      </DialogDescription>
    </>
  );
}
