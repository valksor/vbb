import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  getPendingInteraction,
  queuedThreadMessages as queuedThreadMessageTable,
  threads as threadTable,
} from "@bb/db";
import type { JsonValue } from "@bb/domain";
import { toPendingInteraction } from "../../src/services/interactions/pending-interaction-serialization.js";
import type { AppDeps } from "../../src/types.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const LATE_ANSWER = { answers: { q0: { selected: ["q0o0"] } } };
const PLUGIN_OWNER = { pluginId: "secrets" };

function seedLateAnswerThread(deps: AppDeps, suffix: string) {
  const { host } = seedHostSession(deps, {
    id: `host-plugin-interaction-${suffix}`,
  });
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  const environment = seedEnvironment(deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
  seedThreadRuntimeState(deps, {
    environmentId: thread.environmentId,
    providerThreadId: `provider-${suffix}`,
    threadId: thread.id,
  });
  return thread;
}

function requestAskUserQuestion(
  deps: AppDeps,
  args: {
    threadId: string;
    timeoutMs: number;
    describeSubmission: Parameters<
      AppDeps["pendingInteractions"]["requestPluginInteraction"]
    >[0]["describeSubmission"];
  },
) {
  return deps.pendingInteractions.requestPluginInteraction({
    pluginId: "ask-user-question",
    rendererId: "ask-user-question",
    threadId: args.threadId,
    title: "Layout",
    payload: {
      questions: [
        {
          id: "q0",
          prompt: "Which layout?",
          shortLabel: "Layout",
          multiSelect: false,
          options: [{ value: "q0o0", label: "Inner area" }],
          allowFreeText: true,
        },
      ],
    },
    presentation: {
      label: { pending: "Waiting", completed: "Answered" },
      icon: { glyph: "Toolbox" },
    },
    describeSubmission: args.describeSubmission,
    timeoutMs: args.timeoutMs,
    owner: PLUGIN_OWNER,
  });
}

async function timeOutAskUserQuestion(
  deps: AppDeps,
  args: { threadId: string },
) {
  const request = requestAskUserQuestion(deps, {
    threadId: args.threadId,
    timeoutMs: 1,
    describeSubmission: null,
  });
  const [interaction] = deps.pendingInteractions.listPendingThreadInteractions(
    args.threadId,
  );
  await expect(request).resolves.toEqual({
    outcome: "cancelled",
    reason: "timeout",
  });
  return interaction!;
}

function queuedMessageContents(deps: AppDeps, threadId: string): string[] {
  return deps.db
    .select({ content: queuedThreadMessageTable.content })
    .from(queuedThreadMessageTable)
    .where(eq(queuedThreadMessageTable.threadId, threadId))
    .all()
    .map((row) => row.content);
}

describe("pending interaction lifecycle", () => {
  it("queues one message for a late AskUserQuestion answer and accepts an identical retry", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedLateAnswerThread(harness.deps, "late-answer");
      const interaction = await timeOutAskUserQuestion(harness.deps, {
        threadId: thread.id,
      });
      const respond = () =>
        harness.app.request(
          `/api/v1/threads/${thread.id}/interactions/${interaction.id}/respond`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value: LATE_ANSWER }),
          },
        );

      const first = await respond();
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({
        status: "resolved",
        resolution: {
          kind: "plugin_submitted",
          description: { title: "Answered after the question timed out" },
        },
      });
      expect(queuedMessageContents(harness.deps, thread.id)).toEqual([
        expect.stringContaining("Which layout? — Inner area"),
      ]);

      const retry = await respond();
      expect(retry.status).toBe(200);
      expect(queuedMessageContents(harness.deps, thread.id)).toHaveLength(1);
    });
  });

  it("rolls back the late-answer claim when queue insertion fails", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedLateAnswerThread(harness.deps, "late-rollback");
      const interaction = await timeOutAskUserQuestion(harness.deps, {
        threadId: thread.id,
      });
      const respond = () =>
        harness.app.request(
          `/api/v1/threads/${thread.id}/interactions/${interaction.id}/respond`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value: LATE_ANSWER }),
          },
        );

      harness.db.$client.exec(`
        CREATE TRIGGER reject_late_answer_queue
        BEFORE INSERT ON queued_thread_messages
        BEGIN
          SELECT RAISE(ABORT, 'late answer queue insert failed');
        END;
      `);
      try {
        expect((await respond()).status).toBe(500);
        expect(
          toPendingInteraction(
            getPendingInteraction(harness.deps.db, interaction.id)!,
          ),
        ).toMatchObject({ status: "interrupted", statusReason: "timeout" });
        expect(queuedMessageContents(harness.deps, thread.id)).toEqual([]);
      } finally {
        harness.db.$client.exec("DROP TRIGGER reject_late_answer_queue");
      }

      const retry = await respond();
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ status: "resolved" });
      expect(queuedMessageContents(harness.deps, thread.id)).toHaveLength(1);
    });
  });

  it("queues exactly one message when identical late answers race", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedLateAnswerThread(harness.deps, "late-race");
      const interaction = await timeOutAskUserQuestion(harness.deps, {
        threadId: thread.id,
      });
      const respond = () =>
        harness.deps.pendingInteractions.respondToPluginInteraction({
          threadId: thread.id,
          interactionId: interaction.id,
          value: LATE_ANSWER,
        });

      const results = await Promise.all([respond(), respond()]);

      expect(results.map((result) => result.status)).toEqual([
        "resolved",
        "resolved",
      ]);
      expect(queuedMessageContents(harness.deps, thread.id)).toHaveLength(1);
    });
  });

  it("keeps a late answer recoverable when it cannot be delivered", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedLateAnswerThread(harness.deps, "late-failed");
      const interaction = await timeOutAskUserQuestion(harness.deps, {
        threadId: thread.id,
      });
      const respond = (value: JsonValue) =>
        harness.deps.pendingInteractions.respondToPluginInteraction({
          threadId: thread.id,
          interactionId: interaction.id,
          value,
        });
      const expectStillTimedOut = () =>
        expect(
          toPendingInteraction(
            getPendingInteraction(harness.deps.db, interaction.id)!,
          ),
        ).toMatchObject({ status: "interrupted", statusReason: "timeout" });

      await expect(
        respond({ answers: { q0: { selected: [] } } }),
      ).rejects.toMatchObject({ status: 400 });
      expectStillTimedOut();

      harness.deps.db
        .update(threadTable)
        .set({ archivedAt: Date.now() })
        .where(eq(threadTable.id, thread.id))
        .run();
      await expect(respond(LATE_ANSWER)).rejects.toMatchObject({
        status: 409,
      });
      expectStillTimedOut();
      expect(queuedMessageContents(harness.deps, thread.id)).toEqual([]);

      harness.deps.db
        .update(threadTable)
        .set({ archivedAt: null })
        .where(eq(threadTable.id, thread.id))
        .run();
      await expect(respond(LATE_ANSWER)).resolves.toMatchObject({
        status: "resolved",
      });
      expect(queuedMessageContents(harness.deps, thread.id)).toHaveLength(1);
    });
  });

  it("recovers an answer whose submit was overtaken by the question timeout", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedLateAnswerThread(harness.deps, "late-overtaken");
      let releaseDescription: () => void = () => undefined;
      const descriptionGate = new Promise<void>((resolve) => {
        releaseDescription = resolve;
      });
      const request = requestAskUserQuestion(harness.deps, {
        threadId: thread.id,
        timeoutMs: 20,
        describeSubmission: async () => {
          await descriptionGate;
          return { title: "Answered Which layout?" };
        },
      });
      const [interaction] =
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        );
      const submitted =
        harness.deps.pendingInteractions.respondToPluginInteraction({
          threadId: thread.id,
          interactionId: interaction!.id,
          value: LATE_ANSWER,
        });

      await expect(request).resolves.toEqual({
        outcome: "cancelled",
        reason: "timeout",
      });
      releaseDescription();

      await expect(submitted).resolves.toMatchObject({
        status: "resolved",
        resolution: {
          description: { title: "Answered after the question timed out" },
        },
      });
      expect(queuedMessageContents(harness.deps, thread.id)).toEqual([
        expect.stringContaining("Which layout? — Inner area"),
      ]);
    });
  });

  it("rejects late answers to interrupted interactions other than AskUserQuestion", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedLateAnswerThread(harness.deps, "late-other");
      const unrelated =
        harness.deps.pendingInteractions.requestPluginInteraction({
          pluginId: "secrets",
          rendererId: "secret-request",
          threadId: thread.id,
          title: "Add secrets",
          payload: { fields: [{ name: "API_KEY" }] },
          presentation: {
            label: { pending: "Waiting", completed: "Submitted" },
            icon: { glyph: "Toolbox" },
          },
          describeSubmission: null,
          timeoutMs: 1,
          owner: PLUGIN_OWNER,
        });
      const [unrelatedInteraction] =
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        );
      await expect(unrelated).resolves.toEqual({
        outcome: "cancelled",
        reason: "timeout",
      });
      await expect(
        harness.deps.pendingInteractions.respondToPluginInteraction({
          threadId: thread.id,
          interactionId: unrelatedInteraction!.id,
          value: { values: {} },
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(queuedMessageContents(harness.deps, thread.id)).toEqual([]);
    });
  });
});
