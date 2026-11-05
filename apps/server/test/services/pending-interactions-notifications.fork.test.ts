import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  getOldestPendingInteractionKindInputs,
  pendingInteractions as pendingInteractionTable,
  setPendingInteractionResolving,
} from "@bb/db";
import {
  threadChangeMetadataSchema,
  type PendingInteractionCreate,
} from "@bb/domain";
import { threadListResponseSchema } from "@bb/server-contract";
import { PendingInteractionLifecycle } from "../../src/services/interactions/pending-interactions.js";
import type { AppDeps } from "../../src/types.js";
import type { NotificationHub } from "../../src/ws/hub.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  createAllowOnceResolution,
  createUserAnswerResolution,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

function registerPendingInteraction(
  deps: Pick<AppDeps, "db" | "hub">,
  lifecycle: PendingInteractionLifecycle,
  interaction: PendingInteractionCreate,
) {
  seedTurnStarted(deps, {
    threadId: interaction.threadId,
    turnId: interaction.turnId,
    providerThreadId: interaction.providerThreadId,
  });
  return lifecycle.registerPendingInteraction({ interaction });
}

function createPlanApprovalPayload(): PendingInteractionCreate["payload"] {
  return {
    kind: "approval",
    subject: {
      kind: "plan",
      itemId: "item-plan-approval",
      plan: "Introduce the pending interaction kind",
      planFilePath: null,
    },
    reason: null,
    availableDecisions: ["allow_once", "deny"],
  };
}

function requireRegisteredInteraction(
  outcome: ReturnType<
    PendingInteractionLifecycle["registerPendingInteraction"]
  >,
) {
  if (outcome.outcome === "rejected") {
    throw new Error(
      `Expected interaction registration to succeed: ${outcome.reason}`,
    );
  }
  return outcome.interaction;
}

type NotifyThreadCall = Parameters<NotificationHub["notifyThread"]>;

function lastInteractionChangeCall(
  calls: NotifyThreadCall[],
): NotifyThreadCall {
  const interactionCalls = calls.filter(
    (call) => call[1].length === 1 && call[1][0] === "interactions-changed",
  );
  expect(interactionCalls).not.toHaveLength(0);
  return interactionCalls[interactionCalls.length - 1]!;
}

function countInteractionChangeCalls(calls: NotifyThreadCall[]): number {
  return calls.filter(
    (call) => call[1].length === 1 && call[1][0] === "interactions-changed",
  ).length;
}

function seedPluginInteractionThread(deps: AppDeps, suffix: string) {
  const { host } = seedHostSession(deps, {
    id: `host-plugin-interaction-${suffix}`,
  });
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  const environment = seedEnvironment(deps, {
    hostId: host.id,
    projectId: project.id,
  });
  return seedThread(deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
}

describe("pending interaction notification metadata", () => {
  it("carries the remaining row's kind when one of two pending interactions resolves", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedPluginInteractionThread(
        harness.deps,
        "kind-remaining",
      );
      const notifyThread = vi.spyOn(harness.hub, "notifyThread");

      const plan = requireRegisteredInteraction(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: "turn-kind-remaining-1",
            providerId: "codex",
            providerThreadId: "provider-thread-kind-remaining-1",
            providerRequestId: "request-kind-remaining-1",
            payload: createPlanApprovalPayload(),
          },
        ),
      );
      const question = requireRegisteredInteraction(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: "turn-kind-remaining-2",
            providerId: "codex",
            providerThreadId: "provider-thread-kind-remaining-2",
            providerRequestId: "request-kind-remaining-2",
            payload: createUserQuestionPayload(),
          },
        ),
      );
      harness.db
        .update(pendingInteractionTable)
        .set({ createdAt: 1000 })
        .where(eq(pendingInteractionTable.id, plan.id))
        .run();
      harness.db
        .update(pendingInteractionTable)
        .set({ createdAt: 2000 })
        .where(eq(pendingInteractionTable.id, question.id))
        .run();

      harness.db.transaction((tx) =>
        harness.deps.pendingInteractions.completeResolvingInteractionInTransaction(
          { db: tx, hub: harness.deps.hub },
          {
            interactionId: plan.id,
            resolution: createAllowOnceResolution(),
          },
        ),
      );

      expect(
        threadChangeMetadataSchema.parse(
          lastInteractionChangeCall(notifyThread.mock.calls)[2],
        ),
      ).toEqual({
        hasPendingInteraction: true,
        pendingInteractionKind: "question",
        projectId: thread.projectId,
      });
    });
  });

  it("reports a null kind while only a resolving interaction is active", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedPluginInteractionThread(
        harness.deps,
        "kind-resolving",
      );
      const notifyThread = vi.spyOn(harness.hub, "notifyThread");

      const plan = requireRegisteredInteraction(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: "turn-kind-resolving-1",
            providerId: "codex",
            providerThreadId: "provider-thread-kind-resolving-1",
            providerRequestId: "request-kind-resolving-1",
            payload: createPlanApprovalPayload(),
          },
        ),
      );
      const question = requireRegisteredInteraction(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: "turn-kind-resolving-2",
            providerId: "codex",
            providerThreadId: "provider-thread-kind-resolving-2",
            providerRequestId: "request-kind-resolving-2",
            payload: createUserQuestionPayload(),
          },
        ),
      );

      setPendingInteractionResolving(harness.db, {
        id: plan.id,
        resolution: JSON.stringify(createAllowOnceResolution()),
      });

      harness.db.transaction((tx) =>
        harness.deps.pendingInteractions.completeResolvingInteractionInTransaction(
          { db: tx, hub: harness.deps.hub },
          {
            interactionId: question.id,
            resolution: createUserAnswerResolution(),
          },
        ),
      );

      expect(
        threadChangeMetadataSchema.parse(
          lastInteractionChangeCall(notifyThread.mock.calls)[2],
        ),
      ).toEqual({
        hasPendingInteraction: true,
        pendingInteractionKind: null,
        projectId: thread.projectId,
      });
    });
  });

  it("settles with the generic kind when a corrupt sibling row is pending", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedPluginInteractionThread(harness.deps, "kind-corrupt");
      const notifyThread = vi.spyOn(harness.hub, "notifyThread");

      const question = requireRegisteredInteraction(
        registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: "turn-kind-corrupt-1",
            providerId: "codex",
            providerThreadId: "provider-thread-kind-corrupt-1",
            providerRequestId: "request-kind-corrupt-1",
            payload: createUserQuestionPayload(),
          },
        ),
      );
      harness.db
        .update(pendingInteractionTable)
        .set({ createdAt: 1000 })
        .where(eq(pendingInteractionTable.id, question.id))
        .run();
      harness.db
        .insert(pendingInteractionTable)
        .values({
          id: "pint_kind_corrupt_sibling",
          threadId: thread.id,
          originKind: "provider",
          turnId: "turn-kind-corrupt-2",
          providerId: "codex",
          providerThreadId: "provider-thread-kind-corrupt-2",
          providerRequestId: "request-kind-corrupt-2",
          status: "pending",
          payload: '{"kind":"approval","subject":',
          resolution: null,
          statusReason: null,
          createdAt: 2000,
          expiresAt: null,
          resolvedAt: null,
          updatedAt: 2000,
        })
        .run();

      expect(
        getOldestPendingInteractionKindInputs(harness.db, thread.id),
      ).toEqual({
        payloadKind: "user_question",
        approvalSubjectKind: null,
      });
      expect(lastInteractionChangeCall(notifyThread.mock.calls)[2]).toEqual({
        hasPendingInteraction: true,
        pendingInteractionKind: "question",
        projectId: thread.projectId,
      });
      const callsBeforeSettle = countInteractionChangeCalls(
        notifyThread.mock.calls,
      );

      harness.db.transaction((tx) =>
        harness.deps.pendingInteractions.completeResolvingInteractionInTransaction(
          { db: tx, hub: harness.deps.hub },
          {
            interactionId: question.id,
            resolution: createUserAnswerResolution(),
          },
        ),
      );

      expect(
        countInteractionChangeCalls(notifyThread.mock.calls),
      ).toBeGreaterThan(callsBeforeSettle);
      expect(
        threadChangeMetadataSchema.parse(
          lastInteractionChangeCall(notifyThread.mock.calls)[2],
        ),
      ).toEqual({
        hasPendingInteraction: true,
        pendingInteractionKind: "approval",
        projectId: thread.projectId,
      });
    });
  });

  it("reports the pending plan approval kind through the thread list route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-list-kind",
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
      });
      const notifyThread = vi.spyOn(harness.hub, "notifyThread");

      registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-list-kind-1",
          providerId: "codex",
          providerThreadId: "provider-thread-list-kind",
          providerRequestId: "request-list-kind",
          payload: createPlanApprovalPayload(),
        },
      );

      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
        { method: "GET" },
      );
      expect(response.status).toBe(200);
      const entries = threadListResponseSchema.parse(await readJson(response));
      expect(entries.find((entry) => entry.id === thread.id)).toMatchObject({
        hasPendingInteraction: true,
        pendingInteractionKind: "plan_approval",
      });

      expect(
        threadChangeMetadataSchema.parse(
          lastInteractionChangeCall(notifyThread.mock.calls)[2],
        ),
      ).toEqual({
        hasPendingInteraction: true,
        pendingInteractionKind: "plan_approval",
        projectId: project.id,
      });
    });
  });
});
