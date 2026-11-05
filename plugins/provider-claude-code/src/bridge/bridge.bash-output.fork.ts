import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadDelta } from "@get-bb/plugin-sdk/provider-bridge";
import type { ClaudeDeltaTranslator } from "../delta-translation.js";
import {
  claudeTaskNotificationMessageSchema,
  claudeTaskStartedMessageSchema,
  claudeTaskUpdatedMessageSchema,
} from "../schemas.js";
import {
  ClaudeBashOutputFollower,
  claudeCodeTempRoot,
} from "./bash-output-follower.js";

type SendThreadDeltas = (
  threadId: string,
  deltas: readonly ThreadDelta[],
) => void;

interface BashOutputThreadSession {
  bashOutputFollower: ClaudeBashOutputFollower;
  translator: ClaudeDeltaTranslator;
}

export function createThreadBashOutputFollower(attachment: {
  sessionOptions: { env?: NodeJS.ProcessEnv };
}): ClaudeBashOutputFollower {
  return new ClaudeBashOutputFollower({
    tempRoot: claudeCodeTempRoot(attachment.sessionOptions.env ?? {}),
  });
}

export function observeBashOutputBeforeEmit(
  threadSession: BashOutputThreadSession,
  threadId: string,
  message: SDKMessage,
  sendThreadDeltas: SendThreadDeltas,
): void {
  attachOutputFileBeforeTaskEnds(
    threadSession,
    threadId,
    message,
    sendThreadDeltas,
  );
}

export function observeBashOutputAfterEmit(
  threadSession: BashOutputThreadSession,
  threadId: string,
  message: SDKMessage,
  sendThreadDeltas: SendThreadDeltas,
): void {
  const taskId = endedTaskId(message);
  if (taskId !== undefined) {
    threadSession.bashOutputFollower.cancelResolve(taskId);
  }
  resolveBackgroundBashOutputFile(
    threadSession,
    threadId,
    message,
    sendThreadDeltas,
  );
}

function endedTaskId(message: SDKMessage): string | undefined {
  const updated = claudeTaskUpdatedMessageSchema.safeParse(message);
  if (updated.success) {
    const { status } = updated.data.patch;
    return status === "completed" || status === "failed" || status === "killed"
      ? updated.data.task_id
      : undefined;
  }
  const notified = claudeTaskNotificationMessageSchema.safeParse(message);
  return notified.success ? notified.data.task_id : undefined;
}

function attachOutputFileBeforeTaskEnds(
  threadSession: BashOutputThreadSession,
  threadId: string,
  message: SDKMessage,
  sendThreadDeltas: SendThreadDeltas,
): void {
  const taskId = endedTaskId(message);
  if (taskId === undefined || message.session_id === undefined) {
    return;
  }
  const providerItemKey =
    threadSession.translator.backgroundTaskAwaitingOutputFileKey(
      threadId,
      taskId,
    );
  if (providerItemKey === undefined) {
    return;
  }
  const path = threadSession.bashOutputFollower.locateOutputFileSync({
    taskId,
    sessionId: message.session_id,
  });
  if (path === undefined) {
    return;
  }
  sendThreadDeltas(
    threadId,
    threadSession.translator.setBackgroundTaskOutputFile(threadId, {
      taskId,
      providerItemKey,
      path,
    }),
  );
}

function resolveBackgroundBashOutputFile(
  threadSession: BashOutputThreadSession,
  threadId: string,
  message: SDKMessage,
  sendThreadDeltas: SendThreadDeltas,
): void {
  const started = claudeTaskStartedMessageSchema.safeParse(message);
  if (
    !started.success ||
    started.data.task_type !== "local_bash" ||
    message.session_id === undefined
  ) {
    return;
  }
  const taskId = started.data.task_id;
  const providerItemKey = threadSession.translator.backgroundTaskItemKey(
    threadId,
    taskId,
  );
  if (providerItemKey === undefined) {
    return;
  }
  threadSession.bashOutputFollower.resolveOutputFile(
    { taskId, sessionId: message.session_id },
    (path) =>
      sendThreadDeltas(
        threadId,
        threadSession.translator.setBackgroundTaskOutputFile(threadId, {
          taskId,
          providerItemKey,
          path,
        }),
      ),
  );
}
