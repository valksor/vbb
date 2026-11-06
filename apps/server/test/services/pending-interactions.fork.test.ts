import { describe, expect, it } from "vitest";
import type { PendingInteractionCreate } from "@bb/domain";
import { PendingInteractionLifecycle } from "../../src/services/interactions/pending-interactions.js";
import type { AppDeps } from "../../src/types.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  createCommandApprovalPayload,
  createDenyResolution,
  createFileChangeApprovalPayload,
  createPermissionGrantApprovalPayload,
  createToolUseApprovalPayload,
} from "../helpers/pending-interactions.js";
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
  return lifecycle.registerPendingInteraction({
    interaction,
  });
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

describe("pending interaction lifecycle", () => {
  it("accepts deny messages on plan approvals and rejects them for other approval subjects", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-deny-message",
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

      const planApproval = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-deny-message-plan",
          providerId: "codex",
          providerThreadId: "provider-thread-deny-message",
          providerRequestId: "request-deny-message-plan",
          payload: createPlanApprovalPayload(),
        },
      );
      if (planApproval.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${planApproval.reason}`,
        );
      }
      expect(
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: planApproval.interaction.id,
          resolution: { decision: "deny", message: "Held for review" },
        }),
      ).toEqual(
        expect.objectContaining({
          status: "resolving",
          resolution: { decision: "deny", message: "Held for review" },
        }),
      );

      const nonPlanSubjects = [
        {
          turnId: "turn-deny-message-command",
          payload: createCommandApprovalPayload(),
        },
        {
          turnId: "turn-deny-message-file-change",
          payload: createFileChangeApprovalPayload(),
        },
        {
          turnId: "turn-deny-message-permission-grant",
          payload: createPermissionGrantApprovalPayload(),
        },
        {
          turnId: "turn-deny-message-tool-use",
          payload: createToolUseApprovalPayload(),
        },
      ];
      for (const [index, subject] of nonPlanSubjects.entries()) {
        const created = registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: subject.turnId,
            providerId: "codex",
            providerThreadId: "provider-thread-deny-message",
            providerRequestId: `request-deny-message-${index}`,
            payload: subject.payload,
          },
        );
        if (created.outcome === "rejected") {
          throw new Error(
            `Expected interaction registration to succeed: ${created.reason}`,
          );
        }
        expect(() =>
          harness.deps.pendingInteractions.resolvePendingInteraction({
            threadId: thread.id,
            interactionId: created.interaction.id,
            resolution: { decision: "deny", message: "Held for review" },
          }),
        ).toThrow(
          expect.objectContaining({
            status: 400,
            message: "A deny message is only accepted for plan approvals",
          }),
        );
      }
    });
  });

  it("treats deny messages as part of idempotent resolution retries", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-deny-message-retries",
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

      const registerPlanApproval = (suffix: string) => {
        const created = registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: `turn-deny-message-retries-${suffix}`,
            providerId: "codex",
            providerThreadId: "provider-thread-deny-message-retries",
            providerRequestId: `request-deny-message-retries-${suffix}`,
            payload: createPlanApprovalPayload(),
          },
        );
        if (created.outcome === "rejected") {
          throw new Error(
            `Expected interaction registration to succeed: ${created.reason}`,
          );
        }
        return created;
      };

      const sameMessage = registerPlanApproval("same");
      expect(
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: sameMessage.interaction.id,
          resolution: { decision: "deny", message: "Held for review" },
        }).status,
      ).toBe("resolving");
      expect(
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: sameMessage.interaction.id,
          resolution: { decision: "deny", message: "Held for review" },
        }),
      ).toMatchObject({
        id: sameMessage.interaction.id,
        status: "resolving",
        resolution: { decision: "deny", message: "Held for review" },
      });

      const differentMessage = registerPlanApproval("different");
      harness.deps.pendingInteractions.resolvePendingInteraction({
        threadId: thread.id,
        interactionId: differentMessage.interaction.id,
        resolution: { decision: "deny", message: "Held for review" },
      });
      expect(() =>
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: differentMessage.interaction.id,
          resolution: { decision: "deny", message: "Different concern" },
        }),
      ).toThrow(
        expect.objectContaining({
          status: 409,
          message: `Pending interaction ${differentMessage.interaction.id} is already resolving`,
        }),
      );

      const absentMessage = registerPlanApproval("absent");
      expect(
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: absentMessage.interaction.id,
          resolution: createDenyResolution(),
        }).status,
      ).toBe("resolving");
      expect(
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: absentMessage.interaction.id,
          resolution: createDenyResolution(),
        }),
      ).toMatchObject({
        id: absentMessage.interaction.id,
        status: "resolving",
        resolution: { decision: "deny" },
      });
      expect(() =>
        harness.deps.pendingInteractions.resolvePendingInteraction({
          threadId: thread.id,
          interactionId: absentMessage.interaction.id,
          resolution: { decision: "deny", message: "Held for review" },
        }),
      ).toThrow(
        expect.objectContaining({
          status: 409,
          message: `Pending interaction ${absentMessage.interaction.id} is already resolving`,
        }),
      );
    });
  });
});
