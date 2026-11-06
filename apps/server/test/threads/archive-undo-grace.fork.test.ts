import { getThread, threads } from "@bb/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { seedThread, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedArchivableActiveThread(harness: TestAppHarness) {
  return seedThreadFixture(harness, {
    environment: { path: "/tmp/archive-undo-grace", status: "ready" },
    thread: { status: "active" },
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

describe("archive undo grace", () => {
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
});
