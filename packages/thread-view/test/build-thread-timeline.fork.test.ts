import { threadScope } from "@bb/domain";
import type { TimelineRow, TimelineSystemRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildThreadTimelineFromEvents,
  type ThreadEventWithMeta,
} from "../src/index.js";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import type { AcceptedClientRequestContext } from "../src/accepted-client-request-context.js";
import { rowsOfKind } from "./timeline-test-harness.js";

type BuildTimelineRowsThreadStatus = "active" | "idle";

interface SystemProviderTurnWatchdogEventArgs {
  action?: "notify" | "interrupt";
  activeTurnId?: string;
  activeTurnStartedAt?: number;
  elapsedMs?: number;
  firedAt?: number;
  lastActivityEventAt?: number;
  lastActivityEventSequence?: number;
  lastActivityEventType?: string;
  providerId?: string;
  providerThreadId?: string | null;
  seq: number;
  thresholdMs?: number;
}

function systemProviderTurnWatchdogEvent({
  action = "notify",
  activeTurnId = "turn-1",
  activeTurnStartedAt = 1,
  elapsedMs = 901_000,
  firedAt,
  lastActivityEventAt = 100,
  lastActivityEventSequence = 2,
  lastActivityEventType = "turn/input/accepted",
  providerId = "codex",
  providerThreadId = "provider-thread-1",
  seq,
  thresholdMs = 900_000,
}: SystemProviderTurnWatchdogEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "system/provider-turn-watchdog",
      threadId: "thread-1",
      scope: threadScope(),
      reason: "provider-turn-idle",
      action,
      thresholdMs,
      elapsedMs,
      activeTurnId,
      activeTurnStartedAt,
      lastActivityEventSequence,
      lastActivityEventType,
      lastActivityEventAt,
      providerId,
      providerThreadId,
      firedAt: firedAt ?? seq,
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function buildTimelineRows(
  events: ThreadEventWithMeta[],
  threadStatus: BuildTimelineRowsThreadStatus = "idle",
  workspaceRoot: string | null = null,
  acceptedClientRequestContext: AcceptedClientRequestContext = EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
): TimelineRow[] {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext,
    contextWindowEvents: [],
    events,
    options: {
      completedTurnDisplay: "collapse",
      includeNestedRows: true,
      includeDiagnosticOperations: false,
      summarizeShellCommands: true,
      isLatestPage: true,
      threadStatus,
      threadName: "",
      workspaceRoot,
    },
  }).rows;
}

function collectSystemRows(rows: readonly TimelineRow[]): TimelineSystemRow[] {
  return rowsOfKind(rows, "system");
}

describe("buildThreadTimelineFromEvents", () => {
  it("renders the interrupt-stage watchdog as an error", () => {
    const rows = buildTimelineRows([
      systemProviderTurnWatchdogEvent({ action: "interrupt", seq: 1 }),
    ]);

    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        systemKind: "operation",
        operationKind: "generic",
        status: "error",
        title: "Provider turn stopped responding, interrupting turn",
        detail: "No provider activity for 901s after turn/input/accepted",
      }),
    ]);
  });
});
