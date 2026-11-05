import {
  getOldestPendingInteractionKindInputs,
  type DbQueryConnection,
} from "@bb/db";
import {
  classifyPendingInteractionKind,
  type ThreadPendingInteractionKind,
} from "@bb/domain";

export function oldestPendingInteractionKind(
  db: DbQueryConnection,
  threadId: string,
): ThreadPendingInteractionKind | null {
  const oldestInputs = getOldestPendingInteractionKindInputs(db, threadId);
  return oldestInputs === null
    ? null
    : classifyPendingInteractionKind(oldestInputs);
}
