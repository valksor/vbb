import type { TimelineRow } from "@bb/server-contract";

const CLOCK_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const FULL_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

export function formatTimelineRowClock(timestamp: number): string {
  return CLOCK_FORMAT.format(timestamp);
}

export function TimelineRowTime({ timestamp }: { timestamp: number }) {
  return (
    <time
      dateTime={new Date(timestamp).toISOString()}
      title={FULL_FORMAT.format(timestamp)}
      className="shrink-0 text-xs tabular-nums text-subtle-foreground"
    >
      {formatTimelineRowClock(timestamp)}
    </time>
  );
}

function latestTimelineActivityAt(
  rows: readonly TimelineRow[],
): number | undefined {
  const lastRow = rows.at(-1);
  if (lastRow === undefined) {
    return undefined;
  }
  if ("completedAt" in lastRow && lastRow.completedAt !== null) {
    return lastRow.completedAt;
  }
  return lastRow.startedAt;
}

export function resolveOngoingIndicatorStartedAt(
  showActiveThinking: boolean,
  activeThinking: { startedAt: number } | null | undefined,
  rows: readonly TimelineRow[],
): number | undefined {
  return showActiveThinking && activeThinking
    ? activeThinking.startedAt
    : latestTimelineActivityAt(rows);
}

export function WorkingLabelWithTime({
  label,
  startedAt,
}: {
  label: string;
  startedAt: number | undefined;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {startedAt !== undefined ? (
        <TimelineRowTime timestamp={startedAt} />
      ) : null}
      <span className="animate-shine">{label}</span>
    </span>
  );
}
