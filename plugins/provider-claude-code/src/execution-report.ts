import {
  reasoningLevelSchema,
  type ThreadDelta,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { claudeSystemMessageSchema } from "./schemas.js";

const claudeInitSystemMessageSchema = claudeSystemMessageSchema
  .extend({
    subtype: z.literal("init"),
    model: z.string().min(1),
    permissionMode: z.string().optional(),
    effort: z.string().nullable().optional(),
    fast_mode_state: z.string().optional(),
  })
  .passthrough();
type ClaudeInitSystemMessage = z.infer<typeof claudeInitSystemMessageSchema>;

type ThreadExecutionDelta = Extract<ThreadDelta, { kind: "thread.execution" }>;
type ThreadExecution = ThreadExecutionDelta["execution"];

function toBbPermissionMode(
  mode: string | undefined,
): ThreadExecution["permissionMode"] {
  switch (mode) {
    case "acceptEdits":
      return "accept-edits";
    case "auto":
      return "auto";
    case "bypassPermissions":
      return "full";
    default:
      return null;
  }
}

function toBbServiceTier(
  fastModeState: string | undefined,
): ThreadExecution["serviceTier"] {
  switch (fastModeState) {
    case "on":
      return "fast";
    case "off":
      return "default";
    default:
      return null;
  }
}

export function toClaudeExecutionDelta(
  message: ClaudeInitSystemMessage,
): ThreadExecutionDelta {
  return {
    kind: "thread.execution",
    execution: {
      model: message.model,
      reasoningLevel:
        reasoningLevelSchema.safeParse(message.effort).data ?? null,
      permissionMode: toBbPermissionMode(message.permissionMode),
      serviceTier: toBbServiceTier(message.fast_mode_state),
    },
  };
}

export function translateClaudeExecution(event: unknown): ThreadDelta[] | null {
  const initMessage = claudeInitSystemMessageSchema.safeParse(event);
  return initMessage.success
    ? [toClaudeExecutionDelta(initMessage.data)]
    : null;
}
