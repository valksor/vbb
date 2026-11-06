import {
  getThread,
  upsertThreadExecutionReport,
  type AcceptedDaemonEvent,
  type AppendDaemonEventsResult,
  type DbTransaction,
} from "@bb/db";
import type { HostDaemonEventEnvelope } from "@bb/host-daemon-contract";
import {
  getThreadEventScopeTurnId,
  type ThreadExecutionReport,
} from "@bb/domain";
import {
  recordSpendForInsertedEvents,
  type SpendRollupObservationSource,
} from "../services/system/spend-rollup.js";
import type { AppDeps } from "../types.js";

interface ExecutionReportSource {
  execution: ThreadExecutionReport;
  threadId: string;
}

export function partitionExecutionReports<
  TEntry extends { envelope: HostDaemonEventEnvelope },
>(
  entries: TEntry[],
): {
  entries: TEntry[];
  reports: ExecutionReportSource[];
} {
  const kept: TEntry[] = [];
  const reports: ExecutionReportSource[] = [];
  for (const entry of entries) {
    const { event, threadId } = entry.envelope;
    if (event.type === "thread/execution/reported") {
      reports.push({
        threadId,
        execution: event.execution,
      });
      continue;
    }
    kept.push(entry);
  }
  return { entries: kept, reports };
}

function collectSpendObservationSources(
  deps: AppDeps,
  args: {
    acceptedEvents: readonly AcceptedDaemonEvent[];
    entries: readonly { envelope: HostDaemonEventEnvelope }[];
    insertedInputIndexes: readonly number[];
  },
): SpendRollupObservationSource[] {
  const sources: SpendRollupObservationSource[] = [];
  const providerIdByThreadId = new Map<string, string | null>();
  for (const [position, inputIndex] of args.insertedInputIndexes.entries()) {
    const entry = args.entries[inputIndex];
    const accepted = args.acceptedEvents[position];
    if (entry === undefined || accepted === undefined) continue;
    const event = entry.envelope.event;
    if (event.type !== "thread/tokenUsage/updated") continue;
    const threadId = entry.envelope.threadId;
    if (!providerIdByThreadId.has(threadId)) {
      providerIdByThreadId.set(
        threadId,
        getThread(deps.db, threadId)?.providerId ?? null,
      );
    }
    const providerId = providerIdByThreadId.get(threadId) ?? null;
    if (providerId === null) continue;
    sources.push({
      createdAt: accepted.createdAt,
      event,
      providerId,
      sequence: accepted.sequence,
      threadId,
      turnId: getThreadEventScopeTurnId(event.scope) ?? null,
    });
  }
  return sources;
}

export function recordForkIngestInTransaction(
  tx: DbTransaction,
  deps: AppDeps,
  args: {
    entries: readonly { envelope: HostDaemonEventEnvelope }[];
    executionReports: readonly ExecutionReportSource[];
    result: AppendDaemonEventsResult;
  },
): void {
  const reportedAt = Date.now();
  for (const report of args.executionReports) {
    upsertThreadExecutionReport(tx, {
      ...report,
      reportedAt,
    });
  }
  recordSpendForInsertedEvents(
    tx,
    collectSpendObservationSources(deps, {
      acceptedEvents: args.result.acceptedEvents,
      entries: args.entries,
      insertedInputIndexes: args.result.insertedInputIndexes,
    }),
  );
}
