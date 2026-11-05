import { eq } from "drizzle-orm";
import { getThread, events } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../../../src/types.js";
import { listQueuedThreadCommands } from "../../helpers/commands.js";
import { seedThreadFixture } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function requestInteraction(
  deps: AppDeps,
  threadId: string,
  origin: { pluginId: string; rendererId: string },
): void {
  void deps.pendingInteractions.requestPluginInteraction({
    pluginId: origin.pluginId,
    threadId,
    rendererId: origin.rendererId,
    title: "Request input",
    payload: {},
    presentation: {
      label: { pending: "Waiting", completed: "Submitted" },
      icon: { glyph: "MessageQuestion" },
    },
    describeSubmission: null,
    timeoutMs: 60_000,
    owner: { pluginId: origin.pluginId },
  });
}

function settle(
  deps: AppDeps,
  threadId: string,
  reason: "timeout" | "user",
): void {
  const [pending] =
    deps.pendingInteractions.listPendingThreadInteractions(threadId);
  if (!pending) {
    throw new Error("expected a pending interaction");
  }
  deps.pendingInteractions.cancelPluginInteraction({
    interactionId: pending.id,
    threadId,
    reason,
  });
}

describe("haltThreadForUnansweredQuestion", () => {
  const askOrigin = {
    pluginId: "ask-user-question",
    rendererId: "ask-user-question",
  };

  it("stops a live turn when an AskUserQuestion times out", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      requestInteraction(harness.deps, thread.id, askOrigin);
      settle(harness.deps, thread.id, "timeout");
      await flushMicrotasks();

      expect(getThread(harness.deps.db, thread.id)?.status).toBe("stopping");
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all()
          .filter((event) => event.type === "system/thread/interrupted")
          .map((event) => JSON.parse(event.data)),
      ).toContainEqual({ reason: "question-unanswered" });
      await vi.waitFor(() =>
        expect(
          listQueuedThreadCommands(harness, "thread.stop", thread.id),
        ).toHaveLength(1),
      );
      expect(
        listQueuedThreadCommands(harness, "thread.stop", thread.id),
      ).toEqual([
        {
          type: "thread.stop",
          environmentId: thread.environmentId,
          threadId: thread.id,
          intent: "interrupt",
        },
      ]);
    });
  });

  it("does not stop the turn when the user explicitly declines", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      requestInteraction(harness.deps, thread.id, askOrigin);
      settle(harness.deps, thread.id, "user");
      await flushMicrotasks();
      expect(getThread(harness.deps.db, thread.id)?.status).toBe("active");
    });
  });

  it("does not stop an idle thread on timeout", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      requestInteraction(harness.deps, thread.id, askOrigin);
      settle(harness.deps, thread.id, "timeout");
      await flushMicrotasks();
      expect(getThread(harness.deps.db, thread.id)?.status).toBe("idle");
    });
  });

  it("does not stop the turn for a non-AskUserQuestion timeout", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      requestInteraction(harness.deps, thread.id, {
        pluginId: "secrets",
        rendererId: "secret-request",
      });
      settle(harness.deps, thread.id, "timeout");
      await flushMicrotasks();
      expect(getThread(harness.deps.db, thread.id)?.status).toBe("active");
    });
  });

  it("does not stop the turn for another plugin using the same renderer id", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      requestInteraction(harness.deps, thread.id, {
        pluginId: "other-plugin",
        rendererId: "ask-user-question",
      });
      settle(harness.deps, thread.id, "timeout");
      await flushMicrotasks();
      expect(getThread(harness.deps.db, thread.id)?.status).toBe("active");
    });
  });
});
