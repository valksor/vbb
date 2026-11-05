import { getThread, type AppendDaemonEventsResult, type DbTransaction } from "@bb/db";
import { getThreadEventScopeTurnId } from "@bb/domain";
import type { HostDaemonEventEnvelope } from "@bb/host-daemon-contract";
import { recordSpendForInsertedEvents, type SpendRollupObservationSource } from "../services/system/spend-rollup.js";

export function recordInsertedEventSpend(tx: DbTransaction, args: { entries: readonly { envelope: HostDaemonEventEnvelope }[]; result: AppendDaemonEventsResult }): void {
  const sources: SpendRollupObservationSource[] = [];
  const providerIdByThreadId = new Map<string, string | null>();
  for (const [position, inputIndex] of args.result.insertedInputIndexes.entries()) {
    const entry = args.entries[inputIndex];
    const accepted = args.result.acceptedEvents[position];
    if (entry === undefined || accepted === undefined || entry.envelope.event.type !== "thread/tokenUsage/updated") continue;
    const threadId = entry.envelope.threadId;
    if (!providerIdByThreadId.has(threadId)) providerIdByThreadId.set(threadId, getThread(tx, threadId)?.providerId ?? null);
    const providerId = providerIdByThreadId.get(threadId);
    if (providerId === null || providerId === undefined) continue;
    sources.push({ createdAt: accepted.createdAt, event: entry.envelope.event, providerId, sequence: accepted.sequence, threadId, turnId: getThreadEventScopeTurnId(entry.envelope.event.scope) ?? null });
  }
  recordSpendForInsertedEvents(tx, sources);
}
