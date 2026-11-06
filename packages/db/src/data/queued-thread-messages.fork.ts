import { eq } from "drizzle-orm";
import type { DbTransaction } from "../connection.js";
import { queuedThreadMessages } from "../schema.js";
import {
  clearPreviousQueuedMessageGroupEdgeInTransaction,
  getQueuedThreadMessage,
  type QueuedThreadMessageRow,
} from "./queued-thread-messages.js";

export function deleteQueuedThreadMessageInTransaction(
  tx: DbTransaction,
  id: string,
): QueuedThreadMessageRow | null {
  const existing = getQueuedThreadMessage(tx, id);
  if (!existing) return null;
  clearPreviousQueuedMessageGroupEdgeInTransaction(tx, existing);
  tx.delete(queuedThreadMessages).where(eq(queuedThreadMessages.id, id)).run();
  return existing;
}
