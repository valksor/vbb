import { turnScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  hostDaemonEventBatchResponseSchema,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const TURN_ID = "turn-spend-http";
const PROVIDER_THREAD_ID = "provider-thread-spend-http";

function usage(
  total: number,
  last: number,
  threadId: string,
): HostDaemonEventEnvelope {
  const breakdown = (tokens: number) => ({
    inputTokens: tokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: tokens,
  });
  return {
    threadId,
    event: {
      type: "thread/tokenUsage/updated",
      threadId,
      providerThreadId: PROVIDER_THREAD_ID,
      scope: turnScope(TURN_ID),
      tokenUsage: {
        total: breakdown(total),
        last: breakdown(last),
        modelContextWindow: 258_400,
      },
    },
  };
}

describe("daemon event spend rollup", () => {
  it("spend reporting preserves accepted usage across replay and backfill", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-spend-http",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "active",
      });
      const post = async (events: HostDaemonEventEnvelope[]) => {
        const response = await harness.app.request("/internal/session/events", {
          method: "POST",
          headers: internalAuthHeaders(harness, { hostId: host.id }),
          body: JSON.stringify({
            sessionId: session.id,
            eventGroups: groupHostDaemonEvents(events),
          }),
        });
        expect(response.status).toBe(200);
        hostDaemonEventBatchResponseSchema.parse(await readJson(response));
      };

      await post([
        {
          threadId: thread.id,
          event: {
            type: "turn/started",
            threadId: thread.id,
            providerThreadId: PROVIDER_THREAD_ID,
            scope: turnScope(TURN_ID),
          },
        },
      ]);
      await post([
        usage(100, 100, thread.id),
        usage(100, 100, thread.id),
        usage(250, 150, thread.id),
      ]);

      const rollup = async () => {
        const response = await harness.app.request(
          `/api/v1/spend/rollup?threadId=${thread.id}&groupBy=provider`,
        );
        expect(response.status).toBe(200);
        return (await readJson(response)) as {
          rows: {
            providerId: string;
            totalTokens: number;
            costUsd: number | null;
          }[];
        };
      };
      let result = await rollup();
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        providerId: "codex",
        totalTokens: 250,
        costUsd: null,
      });
      await post([usage(250, 150, thread.id)]);
      expect((await rollup()).rows[0]?.totalTokens).toBe(250);
      await post([usage(40, 40, thread.id), usage(90, 50, thread.id)]);
      expect((await rollup()).rows[0]?.totalTokens).toBe(340);
      for (let index = 0; index < 2; index += 1) {
        const response = await harness.app.request("/api/v1/spend/backfill", {
          method: "POST",
        });
        expect(response.status).toBe(200);
      }
      result = await rollup();
      expect(result.rows[0]?.totalTokens).toBe(340);
    });
  });
});
