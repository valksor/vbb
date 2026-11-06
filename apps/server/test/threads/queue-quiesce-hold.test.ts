import {
  acquireWorkQuiesceLease,
  createQueuedThreadMessage,
  getQueuedThreadMessage,
  getThread,
  listEvents,
  listQueuedThreadMessages,
  releaseWorkQuiesceLease,
  setQueuedThreadMessageFailureReason,
  transitionWorkQuiescePhase,
} from "@bb/db";
import { turnRequestEventDataSchema } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import { recordQueuedMessageDrainFailure } from "../../src/services/threads/queue-drain-failure.js";
import {
  runQueuedMessageDispatch,
  type QueuedMessageDispatchWake,
} from "../../src/services/threads/queued-message-dispatch.js";
import { queueParentSystemMessage } from "../../src/services/threads/parent-system-messages.js";
import {
  isAutomaticQueuedDispatchHeld,
  observeQuiesceHoldEnded,
} from "../../src/services/threads/queue-quiesce.fork.js";
import {
  resumeQueuedWorkAfterQuiesce,
  runQuiesceReleaseHooks,
} from "../../src/services/threads/queue-quiesce-resume.fork.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const OPERATION_ID = "update-queue-hold";
const OWNER_HASH = "owner-hash";

function closeWorkAdmission(harness: TestAppHarness): void {
  acquireWorkQuiesceLease(harness.db, {
    operationId: OPERATION_ID,
    ownerSecretHash: OWNER_HASH,
    reason: "desktop local update",
    now: Date.now(),
    expiresAt: Date.now() + 600_000,
  });
}

function openWorkAdmission(harness: TestAppHarness): void {
  transitionWorkQuiescePhase(harness.db, {
    operationId: OPERATION_ID,
    ownerSecretHash: OWNER_HASH,
    expectedPhase: "draining",
    phase: "releasing",
    now: Date.now(),
  });
  releaseWorkQuiesceLease(harness.db, {
    operationId: OPERATION_ID,
    ownerSecretHash: OWNER_HASH,
    resolution: "completed",
    now: Date.now(),
  });
}

function seedRunnableIdleThread(harness: TestAppHarness, hostId: string) {
  const path = `/tmp/queue-quiesce-hold-${hostId}`;
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: `provider-${hostId}`,
    threadId: thread.id,
  });
  return {
    baselineRequests: turnRequests(harness, thread.id).length,
    environment,
    thread,
  };
}

function turnRequests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).filter(
    (event) => event.type === "client/turn/requested",
  );
}

function waitKind(harness: TestAppHarness, id: string): string | null {
  const raw = getQueuedThreadMessage(harness.db, id)?.waitingOn;
  return raw ? (JSON.parse(raw) as { kind: string }).kind : null;
}

interface HoldCase {
  name: string;
  waitingOn: Parameters<typeof seedQueuedMessage>[1]["waitingOn"];
  sendAt?: number;
  wake: (threadId: string, hostId: string) => QueuedMessageDispatchWake;
  waitClearedByWake: boolean;
  afterRelease: (threadId: string, hostId: string) => QueuedMessageDispatchWake;
  failedOnce?: boolean;
}

const PAST = Date.now() - 60_000;

const HOLD_CASES: HoldCase[] = [
  {
    name: "thread-ready",
    waitingOn: null,
    wake: (threadId) => ({ kind: "thread-ready", threadId }),
    waitClearedByWake: false,
    afterRelease: (threadId) => ({ kind: "thread-ready", threadId }),
  },
  {
    name: "host-connected",
    waitingOn: { kind: "host-offline", hostName: "Test Host" },
    wake: (_threadId, hostId) => ({ kind: "host-connected", hostId }),
    waitClearedByWake: false,
    afterRelease: (_threadId, hostId) => ({ kind: "host-connected", hostId }),
  },
  {
    name: "interaction-settled",
    waitingOn: { kind: "interaction" },
    wake: (threadId) => ({ kind: "interaction-settled", threadId }),
    waitClearedByWake: true,
    afterRelease: (threadId) => ({ kind: "thread-ready", threadId }),
  },
  {
    name: "workspace-ready",
    waitingOn: { kind: "provisioning" },
    wake: (threadId) => ({ kind: "workspace-ready", threadId }),
    waitClearedByWake: true,
    afterRelease: (threadId) => ({ kind: "thread-ready", threadId }),
  },
  {
    name: "provisioning-ended",
    waitingOn: { kind: "provisioning" },
    wake: (threadId) => ({ kind: "provisioning-ended", threadId }),
    waitClearedByWake: true,
    afterRelease: (threadId) => ({ kind: "thread-ready", threadId }),
  },
  {
    name: "turn-started",
    waitingOn: { kind: "turn-starting" },
    wake: (threadId) => ({ kind: "turn-started", threadId }),
    waitClearedByWake: false,
    afterRelease: (threadId) => ({ kind: "turn-started", threadId }),
  },
  {
    name: "plugin-unregistered",
    waitingOn: { kind: "plugin", pluginId: "limiter", reason: "At capacity" },
    wake: () => ({ kind: "plugin-unregistered", pluginId: "limiter" }),
    waitClearedByWake: true,
    afterRelease: (threadId) => ({ kind: "thread-ready", threadId }),
  },
  {
    name: "plugin-recheck",
    waitingOn: { kind: "plugin", pluginId: "limiter", reason: "At capacity" },
    wake: () => ({ kind: "plugin-recheck" }),
    waitClearedByWake: false,
    afterRelease: () => ({ kind: "plugin-recheck" }),
  },
  {
    name: "time-reached",
    waitingOn: { kind: "time" },
    sendAt: PAST,
    wake: () => ({ kind: "time-reached", now: Date.now() }),
    waitClearedByWake: false,
    afterRelease: () => ({ kind: "time-reached", now: Date.now() }),
  },
  {
    name: "idle-recovery",
    waitingOn: null,
    wake: () => ({ kind: "idle-recovery", now: Date.now() }),
    waitClearedByWake: false,
    afterRelease: () => ({ kind: "idle-recovery", now: Date.now() }),
  },
  {
    name: "failed-retry",
    waitingOn: null,
    failedOnce: true,
    wake: () => ({ kind: "failed-retry", now: Date.now() + 120_000 }),
    waitClearedByWake: false,
    afterRelease: () => ({ kind: "failed-retry", now: Date.now() + 120_000 }),
  },
];

describe("queued dispatch while work is quiesced", () => {
  it.each(HOLD_CASES)(
    "holds a row on the $name wake and dispatches it after release",
    async (holdCase) => {
      await withTestHarness(async (harness) => {
        const hostId = `host-hold-${holdCase.name}`;
        const { baselineRequests, thread } = seedRunnableIdleThread(
          harness,
          hostId,
        );
        const row = seedQueuedMessage(harness.deps, {
          threadId: thread.id,
          content: textInput("held message"),
          waitingOn: holdCase.waitingOn,
          sendAt: holdCase.sendAt ?? null,
        });
        if (holdCase.failedOnce) {
          setQueuedThreadMessageFailureReason(harness.db, harness.deps.hub, {
            id: row.id,
            threadId: thread.id,
            failureReason: "earlier failure",
            now: Date.now(),
            retryDelaysMs: [1],
          });
        }
        const before = getQueuedThreadMessage(harness.db, row.id)!;
        closeWorkAdmission(harness);

        await runQueuedMessageDispatch(
          harness.deps,
          holdCase.wake(thread.id, hostId),
        );

        const held = getQueuedThreadMessage(harness.db, row.id);
        expect(held).not.toBeNull();
        expect(held?.claimToken).toBeNull();
        expect(held?.failureCount).toBe(before.failureCount);
        expect(held?.sendAt).toBe(before.sendAt);
        if (holdCase.waitClearedByWake) {
          expect(waitKind(harness, row.id)).toBeNull();
        } else {
          expect(held?.waitingOn).toBe(before.waitingOn);
        }
        expect(turnRequests(harness, thread.id)).toHaveLength(baselineRequests);
        expect(getThread(harness.db, thread.id)?.status).toBe("idle");

        openWorkAdmission(harness);
        await runQueuedMessageDispatch(
          harness.deps,
          holdCase.afterRelease(thread.id, hostId),
        );

        expect(turnRequests(harness, thread.id)).toHaveLength(
          baselineRequests + 1,
        );
        expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      });
    },
  );

  it("queues a parent notice instead of dispatching it, then delivers it after release", async () => {
    await withTestHarness(async (harness) => {
      const { baselineRequests, thread } = seedRunnableIdleThread(
        harness,
        "host-hold-notice",
      );
      closeWorkAdmission(harness);

      const queued = await queueParentSystemMessage(harness.deps, {
        input: textInput("Child was interrupted."),
        parentThreadId: thread.id,
        systemMessageKind: "child-interrupted",
        systemMessageSubject: null,
      });

      expect(queued).toBe(true);
      expect(turnRequests(harness, thread.id)).toHaveLength(baselineRequests);
      const rows = listQueuedThreadMessages(harness.db, thread.id);
      expect(rows).toHaveLength(1);
      expect(
        getQueuedThreadMessage(harness.db, rows[0]!.id)?.failureCount,
      ).toBe(0);

      openWorkAdmission(harness);
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: thread.id,
      });

      const requests = turnRequests(harness, thread.id)
        .map((event) =>
          turnRequestEventDataSchema.parse(JSON.parse(event.data)),
        )
        .filter((event) => event.initiator === "system");
      expect(requests).toHaveLength(1);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });

  it("does not count work_quiesced as a failure while the lease is held, but does after release", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedRunnableIdleThread(harness, "host-hold-failure");
      const sendAt = Date.now() + 60_000;
      const row = createQueuedThreadMessage(harness.db, harness.deps.hub, {
        threadId: thread.id,
        content: textInput("scheduled"),
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
        senderThreadId: null,
        waitingOn: { kind: "time" },
        sendAt,
        payload: { kind: "inline" },
        systemNotice: null,
      });
      const error = new ApiError(503, "work_quiesced", "Work admission closed");
      const record = () =>
        recordQueuedMessageDrainFailure(harness.deps, {
          error,
          now: Date.now(),
          row,
          thread: getThread(harness.db, thread.id)!,
        });
      closeWorkAdmission(harness);

      record();

      const held = getQueuedThreadMessage(harness.db, row.id);
      expect(held?.failureCount).toBe(0);
      expect(held?.failureReason).toBeNull();
      expect(held?.sendAt).toBe(sendAt);
      expect(waitKind(harness, row.id)).toBe("time");

      openWorkAdmission(harness);
      record();

      const counted = getQueuedThreadMessage(harness.db, row.id);
      expect(counted?.failureCount).toBe(1);
      expect(counted?.failureReason).toBe("Work admission closed");
    });
  });

  it("dispatches held rows when resumeQueuedWorkAfterQuiesce runs after release", async () => {
    await withTestHarness(async (harness) => {
      const idle = seedRunnableIdleThread(harness, "host-resume-idle");
      const offline = seedRunnableIdleThread(harness, "host-resume-offline");
      seedQueuedMessage(harness.deps, {
        threadId: idle.thread.id,
        content: textInput("idle row"),
      });
      seedQueuedMessage(harness.deps, {
        threadId: offline.thread.id,
        content: textInput("offline row"),
        waitingOn: { kind: "host-offline", hostName: "Test Host" },
      });
      closeWorkAdmission(harness);
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: idle.thread.id,
      });
      await runQueuedMessageDispatch(harness.deps, {
        kind: "host-connected",
        hostId: offline.environment.hostId,
      });
      expect(turnRequests(harness, idle.thread.id)).toHaveLength(
        idle.baselineRequests,
      );
      expect(turnRequests(harness, offline.thread.id)).toHaveLength(
        offline.baselineRequests,
      );

      openWorkAdmission(harness);
      resumeQueuedWorkAfterQuiesce(harness.deps);

      await vi.waitFor(() => {
        expect(turnRequests(harness, idle.thread.id)).toHaveLength(
          idle.baselineRequests + 1,
        );
        expect(turnRequests(harness, offline.thread.id)).toHaveLength(
          offline.baselineRequests + 1,
        );
      });
      expect(listQueuedThreadMessages(harness.db, idle.thread.id)).toHaveLength(
        0,
      );
      expect(
        listQueuedThreadMessages(harness.db, offline.thread.id),
      ).toHaveLength(0);
    });
  });

  it("replays a plugin-recheck swallowed during the hold when work resumes", async () => {
    await withTestHarness(async (harness) => {
      const { baselineRequests, thread } = seedRunnableIdleThread(
        harness,
        "host-resume-plugin",
      );
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("plugin held row"),
        waitingOn: {
          kind: "plugin",
          pluginId: "limiter",
          reason: "At capacity",
        },
      });
      closeWorkAdmission(harness);
      await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });
      expect(turnRequests(harness, thread.id)).toHaveLength(baselineRequests);

      openWorkAdmission(harness);
      resumeQueuedWorkAfterQuiesce(harness.deps);

      await vi.waitFor(() => {
        expect(turnRequests(harness, thread.id)).toHaveLength(
          baselineRequests + 1,
        );
      });
    });
  });

  it("logs the hold once per lease operation", async () => {
    await withTestHarness(async (harness) => {
      const info = vi.spyOn(harness.deps.logger, "info");
      expect(isAutomaticQueuedDispatchHeld(harness.deps)).toBe(false);
      closeWorkAdmission(harness);

      expect(isAutomaticQueuedDispatchHeld(harness.deps)).toBe(true);
      expect(isAutomaticQueuedDispatchHeld(harness.deps)).toBe(true);
      const holdLogs = () =>
        info.mock.calls.filter(([fields]) => {
          return (
            typeof fields === "object" &&
            fields !== null &&
            "operationId" in fields &&
            fields.operationId === OPERATION_ID
          );
        });
      expect(holdLogs()).toHaveLength(1);

      openWorkAdmission(harness);
      expect(isAutomaticQueuedDispatchHeld(harness.deps)).toBe(false);
      closeWorkAdmission(harness);
      expect(isAutomaticQueuedDispatchHeld(harness.deps)).toBe(true);
      expect(holdLogs()).toHaveLength(2);
    });
  });

  it("fails open once a draining lease has expired", async () => {
    await withTestHarness(async (harness) => {
      const { baselineRequests, thread } = seedRunnableIdleThread(
        harness,
        "host-expired-lease",
      );
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("not held"),
      });
      acquireWorkQuiesceLease(harness.db, {
        operationId: OPERATION_ID,
        ownerSecretHash: OWNER_HASH,
        reason: "desktop local update",
        now: Date.now() - 120_000,
        expiresAt: Date.now() - 60_000,
      });

      expect(isAutomaticQueuedDispatchHeld(harness.deps)).toBe(false);
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: thread.id,
      });

      expect(turnRequests(harness, thread.id)).toHaveLength(
        baselineRequests + 1,
      );
    });
  });

  it("resumes held work from the idle sweep when a draining lease expires without a release", async () => {
    await withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const { baselineRequests, thread } = seedRunnableIdleThread(
          harness,
          "host-expiry-resume",
        );
        seedQueuedMessage(harness.deps, {
          threadId: thread.id,
          content: textInput("held until expiry"),
        });
        closeWorkAdmission(harness);
        await runQueuedMessageDispatch(harness.deps, {
          kind: "idle-recovery",
          now: Date.now(),
        });
        expect(turnRequests(harness, thread.id)).toHaveLength(baselineRequests);

        vi.setSystemTime(Date.now() + 700_000);
        await runQueuedMessageDispatch(harness.deps, {
          kind: "idle-recovery",
          now: Date.now(),
        });

        await vi.waitFor(() => {
          expect(turnRequests(harness, thread.id)).toHaveLength(
            baselineRequests + 1,
          );
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("reports the end of a hold once, and not after an explicit resume", async () => {
    await withTestHarness(async (harness) => {
      expect(observeQuiesceHoldEnded(harness.db)).toBe(false);
      closeWorkAdmission(harness);
      expect(observeQuiesceHoldEnded(harness.db)).toBe(false);
      openWorkAdmission(harness);
      expect(observeQuiesceHoldEnded(harness.db)).toBe(true);
      expect(observeQuiesceHoldEnded(harness.db)).toBe(false);

      closeWorkAdmission(harness);
      expect(observeQuiesceHoldEnded(harness.db)).toBe(false);
      openWorkAdmission(harness);
      resumeQueuedWorkAfterQuiesce(harness.deps);
      expect(observeQuiesceHoldEnded(harness.db)).toBe(false);
    });
  });

  it("runs every release hook even when one throws", () => {
    const warn = vi.fn();
    const first = vi.fn(() => {
      throw new Error("boom");
    });
    const second = vi.fn();

    expect(() =>
      runQuiesceReleaseHooks({ warn }, [first, second]),
    ).not.toThrow();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
