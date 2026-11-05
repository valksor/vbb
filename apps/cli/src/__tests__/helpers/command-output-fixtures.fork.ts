import type { ProviderPendingInteraction } from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { makeTimelineBase } from "./command-output-fixtures.js";

export function makePlanApprovalPayload(
  itemId: string,
): ProviderPendingInteraction["payload"] {
  return {
    kind: "approval",
    subject: {
      kind: "plan",
      itemId,
      plan: "# Plan\n\nShip it.",
      planFilePath: null,
    },
    reason: "Review the plan",
    availableDecisions: ["allow_once", "deny"],
  };
}

interface BackgroundTaskRowArgs {
  itemId: string;
  taskType?: string;
  taskStatus?: TimelineWorkflowWorkRow["taskStatus"];
  startedAt?: number;
  command?: string | null;
  description?: string;
  outputAvailable?: boolean;
}

export function makeBackgroundTaskRow(
  args: BackgroundTaskRowArgs,
): TimelineWorkflowWorkRow {
  return {
    ...makeTimelineBase({
      id: `thread-1:bg:${args.itemId}`,
      sourceSeqStart: 1,
      ...(args.startedAt === undefined ? {} : { startedAt: args.startedAt }),
    }),
    kind: "work",
    status: "pending",
    workKind: "workflow",
    itemId: args.itemId,
    taskType: args.taskType ?? "local_bash",
    workflowName: null,
    description: args.description ?? "Run the dev server",
    command: args.command ?? null,
    outputAvailable: args.outputAvailable ?? true,
    model: null,
    taskStatus: args.taskStatus ?? "running",
    workflow: null,
    usage: null,
    summary: null,
    error: null,
    completedAt: null,
  };
}
