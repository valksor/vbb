import type { PendingInteractionCreate } from "@bb/domain";
import { describe, expect, it } from "vitest";
import type { AppDeps } from "../../src/types.js";
import type { PendingInteractionLifecycle } from "../../src/services/interactions/pending-interactions.js";
import { readJson } from "../helpers/json.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { seedThreadFixture, seedTurnStarted } from "../helpers/seed.js";
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

describe("public thread interactions", () => {
  it("preserves plan denial messages through the HTTP response and daemon command", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        session: { id: "host-public-thread-plan-denial-message" },
      });
      const planApproval = registerPendingInteraction(
        harness.deps,
        harness.deps.pendingInteractions,
        {
          threadId: thread.id,
          turnId: "turn-plan-approval-deny-message",
          providerId: "codex",
          providerThreadId: "provider-thread-permission-resolution",
          providerRequestId: "request-plan-approval-deny-message",
          payload: {
            kind: "approval",
            subject: {
              kind: "plan",
              itemId: "item-plan-approval-deny-message",
              plan: "Introduce the pending interaction kind",
              planFilePath: null,
            },
            reason: null,
            availableDecisions: ["allow_once", "deny"],
          },
        },
      );
      if (planApproval.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${planApproval.reason}`,
        );
      }

      const planDenyResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/interactions/${planApproval.interaction.id}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision: "deny",
            message: "held for review",
          }),
        },
      );
      expect(planDenyResponse.status).toBe(200);
      await expect(readJson(planDenyResponse)).resolves.toMatchObject({
        id: planApproval.interaction.id,
        status: "resolving",
        resolution: { decision: "deny", message: "held for review" },
      });
      const planDenyCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "interactive.resolve" &&
          command.interactionId === planApproval.interaction.id,
      );
      expect(planDenyCommand.command).toMatchObject({
        type: "interactive.resolve",
        resolution: { decision: "deny", message: "held for review" },
      });
      const planDenyCommandResponse = await reportQueuedCommandSuccess(
        harness,
        planDenyCommand,
        {},
      );
      expect(planDenyCommandResponse.status).toBe(200);
    });
  });

  it.each(["", "   "])(
    "rejects a blank plan denial message before queueing (%j)",
    async (message) => {
      await withTestHarness(async (harness) => {
        const { thread } = seedThreadFixture(harness, {
          session: {
            id: `host-public-thread-plan-denial-blank-${message.length}`,
          },
        });
        const planApproval = registerPendingInteraction(
          harness.deps,
          harness.deps.pendingInteractions,
          {
            threadId: thread.id,
            turnId: `turn-plan-approval-deny-blank-${message.length}`,
            providerId: "codex",
            providerThreadId: "provider-thread-plan-denial-blank",
            providerRequestId: `request-plan-approval-deny-blank-${message.length}`,
            payload: {
              kind: "approval",
              subject: {
                kind: "plan",
                itemId: "item-plan-approval-deny-blank",
                plan: "Introduce the pending interaction kind",
                planFilePath: null,
              },
              reason: null,
              availableDecisions: ["allow_once", "deny"],
            },
          },
        );
        if (planApproval.outcome === "rejected") {
          throw new Error(
            `Expected interaction registration to succeed: ${planApproval.reason}`,
          );
        }

        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/interactions/${planApproval.interaction.id}/resolve`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ decision: "deny", message }),
          },
        );

        expect(response.status).toBe(400);
        expect(
          listQueuedThreadCommands(harness, "interactive.resolve", thread.id),
        ).toEqual([]);
      });
    },
  );
});
