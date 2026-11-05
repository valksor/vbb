import { upsertThreadExecutionReport, type DbTransaction } from "@bb/db";
import type { ThreadExecutionReport } from "@bb/domain";
import type { HostDaemonEventEnvelope } from "@bb/host-daemon-contract";

export interface ExecutionReportSource {
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
      reports.push({ threadId, execution: event.execution });
      continue;
    }
    kept.push(entry);
  }
  return { entries: kept, reports };
}

export function recordExecutionReportsInTransaction(
  tx: DbTransaction,
  executionReports: readonly ExecutionReportSource[],
): void {
  const reportedAt = Date.now();
  for (const report of executionReports) {
    upsertThreadExecutionReport(tx, { ...report, reportedAt });
  }
}
