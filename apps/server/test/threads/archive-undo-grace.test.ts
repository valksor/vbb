import { setTimeout as sleep } from "node:timers/promises";
import {
  createTerminalSession,
  getTerminalSession,
  getThread,
  threads,
} from "@bb/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runThreadLifecycleSweep } from "../../src/services/system/periodic-sweeps.js";
import { hasLiveThreadStopInFlight } from "../../src/services/threads/thread-lifecycle.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  expireArchiveUndoGrace,
  seedThread,
  seedThreadFixture,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedArchivableActiveThread(harness: TestAppHarness) {
  return seedThreadFixture(harness, {
    environment: { path: "/tmp/archive-undo-grace", status: "ready" },
    thread: { status: "active" },
  });
}

function seedRunningTerminal(
  harness: TestAppHarness,
  args: { environmentId: string; hostId: string; threadId: string },
) {
  return createTerminalSession(harness.deps.db, {
    cols: 80,
    daemonSessionId: null,
    environmentId: args.environmentId,
    hostId: args.hostId,
    initialCwd: "/tmp/archive-undo-grace",
    rows: 24,
    status: "running",
    threadId: args.threadId,
    title: "dev server",
  });
}

async function archiveThread(
  harness: TestAppHarness,
  threadId: string,
): Promise<void> {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/archive-all`,
    { method: "POST" },
  );
  expect(response.status).toBe(200);
}

async function waitForStopRpcIdle(args: { threadId: string }): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (!hasLiveThreadStopInFlight(args.threadId)) {
      return;
    }
    await sleep(10);
  }

  throw new Error("Timed out waiting for live thread stop RPC to settle");
}

describe("archive undo grace", () => {
  it("stops a running turn as soon as the thread is archived", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedArchivableActiveThread(harness);

      await archiveThread(harness, thread.id);

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(stopCommand.command).toMatchObject({
        type: "thread.stop",
        environmentId: environment.id,
        threadId: thread.id,
      });
      expect(getThread(harness.db, thread.id)).toMatchObject({
        archivedAt: expect.any(Number),
        status: "stopping",
      });
    });
  });

  it("re-dispatches the stop through the sweep when the first stop fails without settling the thread", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedArchivableActiveThread(harness);
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn-archive-undo-grace",
      });

      await archiveThread(harness, thread.id);
      const firstStop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(getThread(harness.db, thread.id)?.status).toBe("stopping");

      await reportQueuedCommandError(harness, firstStop, {
        errorCode: "test_thread_stop_failure",
        errorMessage: "Test archive stop failure",
      });
      await waitForStopRpcIdle({ threadId: thread.id });
      expect(getThread(harness.db, thread.id)?.status).toBe("stopping");

      await runThreadLifecycleSweep(harness.deps);

      const secondStop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(secondStop.command).toMatchObject({
        environmentId: environment.id,
        threadId: thread.id,
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("stopping");
    });
  });

  it("leaves the thread idle when undo precedes stop completion", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivableActiveThread(harness);

      await archiveThread(harness, thread.id);
      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      const unarchiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );
      expect(unarchiveResponse.status).toBe(200);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        archivedAt: null,
      });

      await reportQueuedCommandSuccess(harness, stopCommand, {
        providerCheckpointId: null,
      });

      expect(getThread(harness.db, thread.id)).toMatchObject({
        archivedAt: null,
        status: "idle",
      });
      expect(
        listQueuedThreadCommands(harness, "thread.stop", thread.id),
      ).toEqual([]);
    });
  });

  it("stops an already-archived active descendant as soon as the parent tree is archived", async () => {
    await withTestHarness(async (harness) => {
      const { environment, project, thread } =
        seedArchivableActiveThread(harness);
      const archivedChild = seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: thread.id,
        environmentId: environment.id,
        status: "active",
      });
      harness.deps.db
        .update(threads)
        .set({ archivedAt: Date.now() })
        .where(eq(threads.id, archivedChild.id))
        .run();

      await archiveThread(harness, thread.id);

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === archivedChild.id,
      );
      expect(stopCommand.command).toMatchObject({
        environmentId: environment.id,
        threadId: archivedChild.id,
      });
      expect(getThread(harness.db, archivedChild.id)?.status).toBe("stopping");
    });
  });

  it("stops an archived thread that is not running without waiting for the grace", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        environment: {
          path: "/tmp/archive-undo-grace-starting",
          status: "ready",
        },
        thread: { status: "starting" },
      });

      await archiveThread(harness, thread.id);

      expect(getThread(harness.db, thread.id)).toMatchObject({
        archivedAt: expect.any(Number),
        status: "idle",
      });
    });
  });

  it("keeps the terminals of a running thread open for the grace, then closes them", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, thread } = seedArchivableActiveThread(harness);
      const terminal = seedRunningTerminal(harness, {
        environmentId: environment.id,
        hostId: host.id,
        threadId: thread.id,
      });

      await archiveThread(harness, thread.id);
      await runThreadLifecycleSweep(harness.deps);

      expect(
        getTerminalSession(harness.db, {
          kind: "terminal",
          terminalId: terminal.id,
        }),
      ).toMatchObject({
        closeReason: null,
        status: "running",
      });

      expireArchiveUndoGrace(harness.deps, thread.id);
      await runThreadLifecycleSweep(harness.deps);

      expect(
        getTerminalSession(harness.db, {
          kind: "terminal",
          terminalId: terminal.id,
        }),
      ).toMatchObject({
        closeReason: "thread-archived",
        status: "exited",
      });
    });
  });

  it("keeps the terminals of an archived thread for the grace after its turn ends", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, thread } = seedArchivableActiveThread(harness);
      const terminal = seedRunningTerminal(harness, {
        environmentId: environment.id,
        hostId: host.id,
        threadId: thread.id,
      });

      await archiveThread(harness, thread.id);
      harness.deps.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, thread.id))
        .run();
      await runThreadLifecycleSweep(harness.deps);

      expect(
        getTerminalSession(harness.db, {
          kind: "terminal",
          terminalId: terminal.id,
        }),
      ).toMatchObject({ closeReason: null, status: "running" });

      expireArchiveUndoGrace(harness.deps, thread.id);
      await runThreadLifecycleSweep(harness.deps);

      expect(
        getTerminalSession(harness.db, {
          kind: "terminal",
          terminalId: terminal.id,
        }),
      ).toMatchObject({ closeReason: "thread-archived", status: "exited" });
    });
  });
});
