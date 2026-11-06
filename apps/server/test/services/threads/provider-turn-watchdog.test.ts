import { getAppSettings, getThread, listEvents, setAppSettings } from "@bb/db";
import { systemProviderTurnWatchdogEventDataSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { runProviderTurnWatchdogSweep } from "../../../src/services/threads/provider-turn-watchdog.js";
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
