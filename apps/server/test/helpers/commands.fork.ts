import type { TestAppHarness } from "./test-app.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "./commands.js";

export async function reportNextEnvironmentAttachSuccess(
  harness: TestAppHarness,
  threadId: string | null,
  args: {
    branchName?: string;
    isWorktree?: boolean;
    path?: string;
  } = {},
): Promise<void> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "environment.attach" &&
      (threadId === null || command.initiator?.threadId === threadId) &&
      (args.path === undefined || command.path === args.path),
  );
  if (queued.command.type !== "environment.attach") {
    throw new Error("Expected environment.attach command");
  }
  await reportQueuedCommandSuccess(harness, queued, {
    path: queued.command.path,
    isGitRepo: true,
    isWorktree: args.isWorktree ?? false,
    branchName: args.branchName ?? "main",
    defaultBranch: "main",
    transcript: [],
  });
}
