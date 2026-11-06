import { asc, eq } from "drizzle-orm";
import { events } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { threadExecutionProfileResponseSchema } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

async function setupEventRoute() {
  const harness = await createTestAppHarness();
  const { host, session } = seedHostSession(harness.deps, {});
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "active",
  });
  return { harness, host, session, thread };
}

async function postEventBatch(args: {
  harness: TestAppHarness;
  sessionId: string;
  events: HostDaemonEventEnvelope[];
}): Promise<void> {
  const response = await args.harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(args.harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      eventGroups: groupHostDaemonEvents(args.events),
    }),
  });
  expect(response.status).toBe(200);
}

async function readExecuted(harness: TestAppHarness, threadId: string) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/execution-profile`,
  );
  expect(response.status).toBe(200);
  return threadExecutionProfileResponseSchema.parse(await readJson(response))
    .executed;
}

describe("executed in the thread execution profile", () => {
  it("rejects reports for a thread owned by another host", async () => {
    const { harness, host, session, thread } = await setupEventRoute();
    const { host: otherHost } = seedHostSession(harness.deps, {});
    const environment = seedEnvironment(harness.deps, {
      hostId: otherHost.id,
      projectId: thread.projectId,
    });
    const foreignThread = seedThread(harness.deps, {
      environmentId: environment.id,
      projectId: thread.projectId,
      status: "active",
    });
    try {
      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness, { hostId: host.id }),
        body: JSON.stringify({
          sessionId: session.id,
          eventGroups: groupHostDaemonEvents([
            {
              threadId: foreignThread.id,
              event: {
                type: "thread/execution/reported",
                threadId: foreignThread.id,
                scope: threadScope(),
                providerThreadId: "claude-session",
                execution: {
                  model: "claude-opus-4-6",
                  reasoningLevel: "high",
                  permissionMode: "full",
                  serviceTier: null,
                },
              },
            },
          ]),
        }),
      });
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        acceptedEvents: [],
        rejectedEvents: [
          {
            eventIndex: 0,
            reason: "thread_not_owned_by_host",
            threadId: foreignThread.id,
          },
        ],
      });
      expect(await readExecuted(harness, foreignThread.id)).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps ordinary event order and timestamps when storing reports", async () => {
    const { harness, session, thread } = await setupEventRoute();
    const reportedAt = 1_773_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(reportedAt);
    try {
      await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            threadId: thread.id,
            event: {
              type: "turn/started",
              threadId: thread.id,
              scope: turnScope("turn-stored-order"),
              providerThreadId: "claude-session",
            },
          },
          {
            threadId: thread.id,
            event: {
              type: "thread/execution/reported",
              threadId: thread.id,
              scope: threadScope(),
              providerThreadId: "claude-session",
              execution: {
                model: "claude-opus-4-6",
                reasoningLevel: "high",
                permissionMode: "full",
                serviceTier: null,
              },
            },
          },
          {
            threadId: thread.id,
            event: {
              type: "turn/completed",
              threadId: thread.id,
              scope: turnScope("turn-stored-order"),
              providerThreadId: "claude-session",
              status: "completed",
            },
          },
        ],
      });
      expect(
        harness.db
          .select({
            createdAt: events.createdAt,
            sequence: events.sequence,
            type: events.type,
          })
          .from(events)
          .where(eq(events.threadId, thread.id))
          .orderBy(asc(events.sequence))
          .all(),
      ).toEqual([
        { createdAt: reportedAt, sequence: 1, type: "turn/started" },
        { createdAt: reportedAt, sequence: 2, type: "turn/completed" },
      ]);
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });


});
