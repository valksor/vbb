import { describe, expect, it } from "vitest";
import type { AppDeps } from "../../src/types.js";
import { ensureThreadIsNotAwaitingUserInteraction } from "../../src/services/threads/thread-send.js";
import { seedThreadFixture, seedTurnStarted } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function requestPluginInteraction(
  deps: AppDeps,
  args: {
    threadId: string;
    signal?: AbortSignal;
    holdToolCall?: boolean;
  },
) {
  return deps.pendingInteractions.requestPluginInteraction({
    pluginId: "secrets",
    threadId: args.threadId,
    rendererId: "secret-request",
    title: "Add secrets",
    payload: { fields: [{ name: "API_KEY" }] },
    presentation: {
      label: {
        pending: "Waiting for Add secrets",
        completed: "Submitted Add secrets",
      },
      icon: { glyph: "Toolbox" },
    },
    describeSubmission: null,
    timeoutMs: 10_000,
    owner: { pluginId: "secrets" },
    ...(args.signal ? { signal: args.signal } : {}),
    ...(args.holdToolCall ? { holdToolCall: true } : {}),
  });
}

describe("hold-tool-call turn binding", () => {
  it("binds a held interaction to the active turn so explicit sends are blocked", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        turnId: "turn-hold-bound",
        providerThreadId: "provider-thread-hold-bound",
      });
      const controller = new AbortController();
      try {
        const pending = requestPluginInteraction(harness.deps, {
          threadId: thread.id,
          holdToolCall: true,
          signal: controller.signal,
        });
        const [interaction] =
          harness.deps.pendingInteractions.listPendingThreadInteractions(
            thread.id,
          );
        expect(interaction?.turnId).toBe("turn-hold-bound");
        expect(
          harness.deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(
            thread.id,
          ),
        ).toBe(true);

        let admissionError: unknown;
        try {
          ensureThreadIsNotAwaitingUserInteraction(harness.deps, thread.id);
        } catch (error) {
          admissionError = error;
        }
        expect(admissionError).toMatchObject({
          body: { code: "awaiting_user_interaction" },
          status: 409,
        });

        controller.abort();
        await pending;
      } finally {
        controller.abort();
      }
    });
  });

  it("leaves a non-held interaction unbound from the turn", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        turnId: "turn-no-hold",
        providerThreadId: "provider-thread-no-hold",
      });
      const controller = new AbortController();
      try {
        const pending = requestPluginInteraction(harness.deps, {
          threadId: thread.id,
          signal: controller.signal,
        });
        const [interaction] =
          harness.deps.pendingInteractions.listPendingThreadInteractions(
            thread.id,
          );
        expect(interaction?.turnId).toBeNull();
        expect(
          harness.deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(
            thread.id,
          ),
        ).toBe(false);
        controller.abort();
        await pending;
      } finally {
        controller.abort();
      }
    });
  });
});
