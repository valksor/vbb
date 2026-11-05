import { threadScope, turnScope } from "@bb/domain";
import type { ThreadEvent, ThreadEventBackgroundTaskItem } from "@bb/domain";
import type { TimelineRow, TimelineWorkflowWorkRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildThreadTimelineFromEvents,
  type ThreadEventWithMeta,
} from "../src/index.js";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import type { ThreadTimelineFromEventsResult } from "../src/build-thread-timeline.js";

function withMeta(event: ThreadEvent, seq: number): ThreadEventWithMeta {
  return {
    event,
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq * 1_000,
    },
  };
}

function buildTimeline(
  events: ThreadEventWithMeta[],
  options: {
    includeNestedRows?: boolean;
  } = {},
): ThreadTimelineFromEventsResult {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events,
    options: {
      completedTurnDisplay: "collapse",
      includeNestedRows: options.includeNestedRows ?? true,
      includeDiagnosticOperations: false,
      summarizeShellCommands: true,
      isLatestPage: true,
      threadStatus: "idle",
      threadName: "",
      workspaceRoot: null,
    },
  });
}

function buildTimelineRows(events: ThreadEventWithMeta[]): TimelineRow[] {
  return buildTimeline(events).rows;
}

function findWorkflowRows(rows: TimelineRow[]): TimelineWorkflowWorkRow[] {
  const found: TimelineWorkflowWorkRow[] = [];
  for (const row of rows) {
    if (row.kind === "work" && row.workKind === "workflow") {
      found.push(row);
    }
    if (row.kind === "turn" && row.children) {
      found.push(...findWorkflowRows(row.children));
    }
  }
  return found;
}

function bashTaskItem(args: {
  taskStatus: ThreadEventBackgroundTaskItem["taskStatus"];
  status: ThreadEventBackgroundTaskItem["status"];
  summary?: string;
  id?: string;
  description?: string;
  command?: string;
  outputFile?: string;
  parentToolCallId?: string;
}): ThreadEventBackgroundTaskItem {
  return {
    type: "backgroundTask",
    id: args.id ?? "task:bmn5wv33k",
    taskType: "local_bash",
    description:
      args.description ?? "Count ticks from 1 to 6 with 1 second delays",
    status: args.status,
    taskStatus: args.taskStatus,
    skipTranscript: false,
    foreground: false,
    ...(args.summary ? { summary: args.summary } : {}),
    ...(args.command ? { command: args.command } : {}),
    ...(args.outputFile ? { outputFile: args.outputFile } : {}),
    ...(args.parentToolCallId
      ? { parentToolCallId: args.parentToolCallId }
      : {}),
  };
}

function turnStarted(turnId: string, seq: number): ThreadEventWithMeta {
  return withMeta(
    {
      type: "turn/started",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: turnScope(turnId),
    },
    seq,
  );
}

function turnCompleted(turnId: string, seq: number): ThreadEventWithMeta {
  return withMeta(
    {
      type: "turn/completed",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: turnScope(turnId),
      status: "completed",
    },
    seq,
  );
}

describe("background task timeline projection", () => {
  it("exposes command and outputAvailable on background command rows without leaking the path", () => {
    const outputFile = "/tmp/claude-501/p/s/tasks/bmn5wv33k.output";
    const timeline = buildTimeline(
      [
        turnStarted("turn-1", 1),
        withMeta(
          {
            type: "item/started",
            threadId: "thread-1",
            providerThreadId: "provider-1",
            scope: turnScope("turn-1"),
            item: bashTaskItem({
              status: "pending",
              taskStatus: "running",
              command: "pnpm run build --watch",
            }),
          },
          2,
        ),
        turnCompleted("turn-1", 3),
      ],
      { includeNestedRows: false },
    );
    expect(timeline.activeBackgroundCommands[0]).toMatchObject({
      command: "pnpm run build --watch",
      outputAvailable: false,
    });

    const withOutput = buildTimeline(
      [
        turnStarted("turn-1", 1),
        withMeta(
          {
            type: "item/started",
            threadId: "thread-1",
            providerThreadId: "provider-1",
            scope: turnScope("turn-1"),
            item: bashTaskItem({
              status: "pending",
              taskStatus: "running",
              command: "pnpm run build --watch",
            }),
          },
          2,
        ),
        turnCompleted("turn-1", 3),
        withMeta(
          {
            type: "item/backgroundTask/progress",
            threadId: "thread-1",
            providerThreadId: "provider-1",
            scope: threadScope(),
            item: bashTaskItem({
              status: "pending",
              taskStatus: "running",
              command: "pnpm run build --watch",
              outputFile,
            }),
          },
          4,
        ),
      ],
      { includeNestedRows: false },
    );
    const row = withOutput.activeBackgroundCommands[0]!;
    expect(row).toMatchObject({
      command: "pnpm run build --watch",
      outputAvailable: true,
    });
    expect(JSON.stringify(row)).not.toContain(outputFile);
  });

  it("reports null command and outputAvailable false when the provider sent neither", () => {
    const rows = buildTimelineRows([
      turnStarted("turn-1", 1),
      withMeta(
        {
          type: "item/started",
          threadId: "thread-1",
          providerThreadId: "provider-1",
          scope: turnScope("turn-1"),
          item: bashTaskItem({ status: "pending", taskStatus: "running" }),
        },
        2,
      ),
    ]);
    expect(findWorkflowRows(rows)[0]).toMatchObject({
      command: null,
      outputAvailable: false,
    });
  });
});
