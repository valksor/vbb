import { z } from "zod";
import {
  deleteQueuedThreadMessage,
  deleteQueuedThreadMessageInTransaction,
  listQueuedThreadMessages,
  type DbConnection,
  type DbNotifier,
  type DbTransaction,
} from "@bb/db";
import type { RecordQueuedMessageWaitArgs } from "./queue-waits.js";

export const ENTER_WORKTREE_CONTINUATION_TEXT =
  "Continue implementing the user's request from the newly prepared worktree.";

const enterWorktreeContinuationInputSchema = z
  .array(
    z
      .object({
        type: z.literal("text"),
        text: z.literal(ENTER_WORKTREE_CONTINUATION_TEXT),
        mentions: z.array(z.unknown()).length(0),
        visibility: z.literal("agent-only"),
      })
      .passthrough(),
  )
  .length(1);

export function isEnterWorktreeContinuationInput(input: unknown): boolean {
  return enterWorktreeContinuationInputSchema.safeParse(input).success;
}

export function isEnterWorktreeContinuationContent(content: string): boolean {
  try {
    return isEnterWorktreeContinuationInput(JSON.parse(content));
  } catch {
    return false;
  }
}

export function isSupersedingUserQueueEnvelope(args: {
  payloadKind: string;
  sendAt: number | null;
  senderThreadId: string | null;
  systemNotice: unknown | null;
}): boolean {
  if (args.senderThreadId !== null || args.systemNotice !== null) return false;
  if (args.payloadKind !== "inline") return false;
  return args.sendAt === null || args.sendAt <= Date.now();
}

type EnterWorktreeContinuationDeleteTarget =
  | { kind: "transaction"; db: DbTransaction }
  | { kind: "notifying"; db: DbConnection; hub: DbNotifier };

export function deleteEnterWorktreeContinuations(
  target: EnterWorktreeContinuationDeleteTarget,
  threadId: string,
): void {
  for (const queuedMessage of listQueuedThreadMessages(target.db, threadId)) {
    if (isEnterWorktreeContinuationContent(queuedMessage.content)) {
      if (target.kind === "transaction") {
        deleteQueuedThreadMessageInTransaction(target.db, queuedMessage.id);
      } else {
        deleteQueuedThreadMessage(target.db, target.hub, queuedMessage.id);
      }
    }
  }
}

export function deleteSupersededWorktreeContinuation(
  tx: DbTransaction,
  args: RecordQueuedMessageWaitArgs,
): void {
  const supersedesContinuation = isSupersedingUserQueueEnvelope({
    payloadKind: args.message.payload.kind,
    sendAt: args.sendAt,
    senderThreadId: args.message.senderThreadId,
    systemNotice: args.message.systemNotice,
  });
  if (!supersedesContinuation) return;
  deleteEnterWorktreeContinuations(
    { kind: "transaction", db: tx },
    args.thread.id,
  );
}

export function clearUserQueuedContinuations(
  tx: DbTransaction,
  threadId: string,
  senderThreadId: string | null,
): void {
  if (senderThreadId !== null) return;
  deleteEnterWorktreeContinuations({ kind: "transaction", db: tx }, threadId);
}

export function clearEnterWorktreeContinuationsAfterSend(
  deps: { db: DbConnection; hub: DbNotifier },
  threadId: string,
): void {
  deleteEnterWorktreeContinuations(
    { kind: "notifying", db: deps.db, hub: deps.hub },
    threadId,
  );
}
