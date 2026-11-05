import {
  createPendingInteraction,
  getAppSettings,
  getPendingInteraction,
  getThread,
  listEvents,
  setAppSettings,
} from "@bb/db";
import { systemProviderTurnWatchdogEventDataSchema } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import { runProviderTurnWatchdogSweep } from "../../../src/services/threads/provider-turn-watchdog.js";
import { registerHostRpcResponder } from "../../helpers/host-rpc.js";
import { readJson } from "../../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

const TURN_STARTED_AT = 1_000_000;
const NOTIFY_MS = 5 * 60_000;
const INTERRUPT_MS = 10 * 60_000;

describe("provider turn watchdog", () => {
  it("does nothing when the watchdog is disabled", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const turnId = "turn-watchdog-disabled";
      seedEvent(harness.deps, {
        createdAt: TURN_STARTED_AT,
        data: { providerThreadId: "provider-thread-disabled" },
        environmentId: environment.id,
        providerThreadId: "provider-thread-disabled",
        scope: { kind: "turn", turnId },
        sequence: 1,
        threadId: thread.id,
        type: "turn/started",
      });
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        providerTurnIdleWatchdogEnabled: false,
        providerTurnIdleNotifyMs: NOTIFY_MS,
        providerTurnIdleInterruptMs: INTERRUPT_MS,
      });

      expect(
        runProviderTurnWatchdogSweep(harness.deps, {
          now: TURN_STARTED_AT + INTERRUPT_MS,
        }),
      ).toEqual({ notifiedThreadIds: [], interruptedThreadIds: [] });
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (event) => event.type === "system/provider-turn-watchdog",
        ),
      ).toEqual([]);
    });
  });

  it("notifies once before interrupting and stopping an idle provider turn", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, session, thread } = seedThreadFixture(
        harness,
        {
          thread: { status: "active" },
        },
      );
      const stopReply = createDeferredPromise<void>();
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        handle: async (request) => {
          if (request.command.type !== "thread.stop") {
            throw new Error(`Unexpected command ${request.command.type}`);
          }
          await stopReply.promise;
          return { ok: true, result: { providerCheckpointId: null } };
        },
      });
      const turnId = "turn-watchdog";
      seedEvent(harness.deps, {
        createdAt: TURN_STARTED_AT,
        data: { providerThreadId: "provider-thread-watchdog" },
        environmentId: environment.id,
        providerThreadId: "provider-thread-watchdog",
        scope: { kind: "turn", turnId },
        sequence: 1,
        threadId: thread.id,
        type: "turn/started",
      });
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        providerTurnIdleNotifyMs: NOTIFY_MS,
        providerTurnIdleInterruptMs: INTERRUPT_MS,
      });

      expect(
        runProviderTurnWatchdogSweep(harness.deps, {
          now: TURN_STARTED_AT + NOTIFY_MS,
        }),
      ).toEqual({
        notifiedThreadIds: [thread.id],
        interruptedThreadIds: [],
      });
      expect(
        runProviderTurnWatchdogSweep(harness.deps, {
          now: TURN_STARTED_AT + NOTIFY_MS + 1,
        }),
      ).toEqual({
        notifiedThreadIds: [],
        interruptedThreadIds: [],
      });

      expect(
        runProviderTurnWatchdogSweep(harness.deps, {
          now: TURN_STARTED_AT + INTERRUPT_MS,
        }),
      ).toEqual({
        notifiedThreadIds: [],
        interruptedThreadIds: [thread.id],
      });

      const watchdogEvents = listEvents(harness.db, { threadId: thread.id })
        .filter((event) => event.type === "system/provider-turn-watchdog")
        .map((event) =>
          systemProviderTurnWatchdogEventDataSchema.parse(
            JSON.parse(event.data) as unknown,
          ),
        );
      expect(watchdogEvents.map((event) => event.action)).toEqual([
        "notify",
        "interrupt",
      ]);
      expect(watchdogEvents.map((event) => event.firedAt)).toEqual([
        TURN_STARTED_AT + NOTIFY_MS,
        TURN_STARTED_AT + INTERRUPT_MS,
      ]);
      expect(getThread(harness.db, thread.id)?.status).toBe("stopping");

      await expect.poll(() => responder.requests).toHaveLength(1);
      expect(responder.requests[0]?.command).toEqual({
        environmentId: environment.id,
        intent: "interrupt",
        threadId: thread.id,
        type: "thread.stop",
      });
      const interaction = createPendingInteraction(harness.db, {
        threadId: thread.id,
        turnId,
        providerId: "codex",
        providerThreadId: "provider-thread-watchdog",
        providerRequestId: "request-watchdog",
        payload: JSON.stringify({
          kind: "approval",
          subject: {
            kind: "command",
            itemId: "item-watchdog-approval",
            command: "pwd",
            cwd: "/tmp/project",
            actions: [],
            sessionGrant: null,
          },
          reason: "Approve command",
          availableDecisions: ["allow_once", "allow_for_session", "deny"],
        }),
      });
      stopReply.resolve();
      await expect
        .poll(() => getThread(harness.db, thread.id)?.status)
        .toBe("error");
      expect(getPendingInteraction(harness.db, interaction.id)).toMatchObject({
        status: "interrupted",
      });
      const settledEvents = listEvents(harness.db, { threadId: thread.id });
      expect(
        settledEvents.find((event) => event.type === "turn/completed"),
      ).toMatchObject({
        turnId,
        data: expect.stringContaining('"status":"interrupted"'),
      });
      expect(
        settledEvents.find(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toMatchObject({
        data: expect.stringContaining('"reason":"provider-turn-idle"'),
      });
      const publicEvents = await readJson(
        await harness.app.request(
          `/api/v1/threads/${thread.id}/events?limit=100`,
        ),
      );
      expect(publicEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "system/provider-turn-watchdog",
            data: expect.objectContaining({
              activeTurnId: turnId,
              providerId: "codex",
              providerThreadId: "provider-thread-watchdog",
            }),
          }),
        ]),
      );
      responder.unregister();
    });
  });

  it("continues notifying and interrupting across watchdog batches", async () => {
    await withTestHarness(async (harness) => {
      const threads = Array.from({ length: 26 }, (_, index) => {
        const { environment, thread } = seedThreadFixture(harness, {
          thread: { status: "active" },
        });
        seedEvent(harness.deps, {
          createdAt: TURN_STARTED_AT - index,
          data: { providerThreadId: `provider-thread-batch-${index}` },
          environmentId: environment.id,
          providerThreadId: `provider-thread-batch-${index}`,
          scope: { kind: "turn", turnId: `turn-batch-${index}` },
          sequence: 1,
          threadId: thread.id,
          type: "turn/started",
        });
        return thread;
      });
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        providerTurnIdleNotifyMs: NOTIFY_MS,
        providerTurnIdleInterruptMs: INTERRUPT_MS,
      });

      const firstNotify = runProviderTurnWatchdogSweep(harness.deps, {
        now: TURN_STARTED_AT + NOTIFY_MS,
      });
      const secondNotify = runProviderTurnWatchdogSweep(harness.deps, {
        now: TURN_STARTED_AT + NOTIFY_MS,
      });
      expect(firstNotify.notifiedThreadIds).toHaveLength(25);
      expect(secondNotify.notifiedThreadIds).toHaveLength(1);
      expect(
        new Set([
          ...firstNotify.notifiedThreadIds,
          ...secondNotify.notifiedThreadIds,
        ]),
      ).toEqual(new Set(threads.map((thread) => thread.id)));

      const firstInterrupt = runProviderTurnWatchdogSweep(harness.deps, {
        now: TURN_STARTED_AT + INTERRUPT_MS,
      });
      const secondInterrupt = runProviderTurnWatchdogSweep(harness.deps, {
        now: TURN_STARTED_AT + INTERRUPT_MS,
      });
      expect(firstInterrupt.interruptedThreadIds).toHaveLength(25);
      expect(secondInterrupt.interruptedThreadIds).toHaveLength(1);
      for (const thread of threads) {
        expect(
          listEvents(harness.db, { threadId: thread.id })
            .filter((event) => event.type === "system/provider-turn-watchdog")
            .map(
              (event) =>
                systemProviderTurnWatchdogEventDataSchema.parse(
                  JSON.parse(event.data) as unknown,
                ).action,
            ),
        ).toEqual(["notify", "interrupt"]);
      }
    });
  });
});
