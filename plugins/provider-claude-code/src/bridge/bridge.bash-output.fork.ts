import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadDelta } from "@get-bb/plugin-sdk/provider-bridge";
import type { ClaudeDeltaTranslator } from "../delta-translation.js";
import {
  claudeTaskNotificationMessageSchema,
  claudeTaskStartedMessageSchema,
  claudeTaskUpdatedMessageSchema,
  claudeUserMessageSchema,
} from "../schemas.js";
import { extractToolResults } from "../sdk-extraction.js";
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

export function createThreadBashOutputFollower(
  attachment: {
    sessionOptions: { env?: NodeJS.ProcessEnv };
    threadIdRef: { current: string };
  },
  sendThreadDeltas: SendThreadDeltas,
): ClaudeBashOutputFollower {
  return new ClaudeBashOutputFollower({
    tempRoot: claudeCodeTempRoot(attachment.sessionOptions.env ?? {}),
    publish: (toolUseId, text) =>
      sendThreadDeltas(attachment.threadIdRef.current, [
        {
          kind: "item.outputDelta",
          key: { providerItemId: toolUseId },
          channel: "command",
          text,
        },
      ]),
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
  followBashOutput(threadSession.bashOutputFollower, message);
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

function followBashOutput(
  follower: ClaudeBashOutputFollower,
  message: SDKMessage,
): void {
  const user = claudeUserMessageSchema.safeParse(message);
  if (user.success) {
    for (const result of extractToolResults(user.data)) {
      follower.stop(result.toolUseId);
    }
    return;
  }
  const started = claudeTaskStartedMessageSchema.safeParse(message);
  if (started.success) {
    const task = started.data;
    if (
      task.task_type === "local_bash" &&
      task.tool_use_id !== undefined &&
      task.is_backgrounded !== true &&
      message.session_id !== undefined
    ) {
      follower.follow({
        toolUseId: task.tool_use_id,
        taskId: task.task_id,
        sessionId: message.session_id,
      });
    }
    return;
  }
  const updated = claudeTaskUpdatedMessageSchema.safeParse(message);
  if (updated.success) {
    const { status, is_backgrounded } = updated.data.patch;
    if (
      is_backgrounded === true ||
      status === "completed" ||
      status === "failed" ||
      status === "killed"
    ) {
      follower.stopTask(updated.data.task_id);
    }
    if (status === "completed" || status === "failed" || status === "killed") {
      follower.cancelResolve(updated.data.task_id);
    }
    return;
  }
  const notified = claudeTaskNotificationMessageSchema.safeParse(message);
  if (notified.success) {
    follower.stopTask(notified.data.task_id);
    follower.cancelResolve(notified.data.task_id);
  }
}
