import type {
  PluginAgentToolResult,
  PluginInteractionCancelReason,
} from "@get-bb/plugin-sdk";
import { buildTimeoutMessage } from "./tool-definition.js";

export function okText(message: string): PluginAgentToolResult {
  return { content: [{ type: "text", text: message }] };
}

export function cancelledResult(
  reason: PluginInteractionCancelReason,
  elapsedMs: number,
): PluginAgentToolResult {
  if (reason === "user") {
    return okText(
      "The user dismissed the question without answering. Proceed with your best judgement, or ask again in your reply.",
    );
  }
  return {
    content: [
      {
        type: "text",
        text:
          reason === "timeout"
            ? buildTimeoutMessage(elapsedMs)
            : "The question was interrupted before it was answered. Stop and wait for the user rather than proceeding.",
      },
    ],
    isError: true,
  };
}
