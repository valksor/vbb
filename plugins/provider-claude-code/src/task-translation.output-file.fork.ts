import {
  LOCAL_BASH_TASK_TYPE,
  type ThreadDelta,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  buildClaudeTaskProgressDelta,
  type ClaudeTaskMap,
} from "./task-translation.js";
import type { ClaudeClassifiedTool } from "./tool-classification.js";

type ClaudeTrackedTask = NonNullable<ReturnType<ClaudeTaskMap["get"]>>;

export type ForwardedToolLookup = (
  toolUseId: string,
) => ClaudeClassifiedTool | undefined;

interface SetClaudeTaskOutputFileArgs {
  taskId: string;
  providerItemKey: string;
  path: string;
}

export function resolveTaskCommand(
  args: { forwardedToolUse: ForwardedToolLookup },
  toolUseId: string | undefined,
  taskType: string,
  existing: ClaudeTrackedTask | undefined,
): string | undefined {
  if (taskType !== LOCAL_BASH_TASK_TYPE) {
    return undefined;
  }
  const tool =
    toolUseId === undefined ? undefined : args.forwardedToolUse(toolUseId);
  return tool?.shape.type === "command" && tool.shape.command.length > 0
    ? tool.shape.command
    : existing?.command;
}

export function setClaudeTaskOutputFile(
  tasks: ClaudeTaskMap,
  args: SetClaudeTaskOutputFileArgs,
): ThreadDelta[] {
  const task = tasks.get(args.taskId);
  if (
    task === undefined ||
    task.terminal ||
    task.providerItemKey !== args.providerItemKey
  ) {
    return [];
  }
  task.outputFile = args.path;
  return task.materialized ? [buildClaudeTaskProgressDelta(task, true)] : [];
}

export function claudeTaskAwaitingOutputFileKey(
  tasks: ClaudeTaskMap,
  taskId: string,
): string | undefined {
  const task = tasks.get(taskId);
  return task === undefined ||
    task.terminal ||
    task.taskType !== LOCAL_BASH_TASK_TYPE ||
    task.outputFile !== undefined
    ? undefined
    : task.providerItemKey;
}

export function claudeTaskItemKey(
  tasks: ClaudeTaskMap,
  taskId: string,
): string | undefined {
  const task = tasks.get(taskId);
  return task === undefined || task.terminal ? undefined : task.providerItemKey;
}

export function claudeTaskOutputFileMethods(
  tasksFor: (threadId: string) => ClaudeTaskMap,
) {
  return {
    backgroundTaskItemKey(threadId: string, taskId: string) {
      return claudeTaskItemKey(tasksFor(threadId), taskId);
    },
    backgroundTaskAwaitingOutputFileKey(threadId: string, taskId: string) {
      return claudeTaskAwaitingOutputFileKey(tasksFor(threadId), taskId);
    },
    setBackgroundTaskOutputFile(
      threadId: string,
      args: SetClaudeTaskOutputFileArgs,
    ): ThreadDelta[] {
      return setClaudeTaskOutputFile(tasksFor(threadId), args);
    },
  };
}
