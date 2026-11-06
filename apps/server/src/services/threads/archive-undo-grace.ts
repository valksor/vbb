import { ARCHIVE_UNDO_GRACE_MS } from "../../constants.js";
import type { Thread } from "@bb/domain";
import { ARCHIVE_GRACE_KEEPS_TURN_RUNNING } from "./archive-undo-grace.fork.js";

type ArchiveUndoGraceThread = Pick<Thread, "archivedAt" | "status">;

export function archiveUndoGraceKeepsTerminals(
  thread: Pick<Thread, "archivedAt">,
  now: number,
): boolean {
  return (
    thread.archivedAt !== null &&
    thread.archivedAt + ARCHIVE_UNDO_GRACE_MS > now
  );
}

export function archiveUndoGraceKeepsTurnRunning(
  thread: ArchiveUndoGraceThread,
  now: number,
): boolean {
  return (
    ARCHIVE_GRACE_KEEPS_TURN_RUNNING &&
    thread.status === "active" &&
    archiveUndoGraceKeepsTerminals(thread, now)
  );
}
