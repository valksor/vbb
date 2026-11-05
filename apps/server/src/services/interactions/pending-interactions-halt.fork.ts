import { getActiveStoredTurnId, type DbTransaction } from "@bb/db";

export function heldToolCallTurnId(
  tx: DbTransaction,
  args: { holdToolCall?: boolean; threadId: string },
): string | null {
  return args.holdToolCall ? getActiveStoredTurnId(tx, args.threadId) : null;
}
