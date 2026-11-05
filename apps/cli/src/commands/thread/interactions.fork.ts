import type { Command } from "commander";
import type {
  ApprovalPendingInteraction,
  ApprovalPendingInteractionResolution,
  PendingInteractionResolution,
} from "@bb/domain";
import { sanitizeBackgroundOutput } from "./background-output.js";

export interface ThreadInteractionDenyOptions {
  message?: string;
}

export function addDenyMessageOption(interactions: Command): void {
  const deny = interactions.commands.find(
    (command) => command.name() === "deny",
  );
  if (deny === undefined) {
    throw new Error("The deny interaction command is not registered.");
  }
  deny.option(
    "--message <text>",
    "plan approvals only; replaces the text the agent sees",
  );
}

export function printDenyMessage(
  resolution: ApprovalPendingInteractionResolution,
): void {
  if (resolution.decision === "deny" && resolution.message !== undefined) {
    console.log(`  Message: ${sanitizeBackgroundOutput(resolution.message)}`);
  }
}

export function assertDenyMessageAccepted(
  interaction: ApprovalPendingInteraction,
  action: "approve" | "deny",
  message: string | undefined,
): void {
  if (
    message !== undefined &&
    (action !== "deny" || interaction.payload.subject.kind !== "plan")
  ) {
    throw new Error("A deny message is only accepted for plan approvals");
  }
}

export function denyMessageResolution(
  message: string | undefined,
): PendingInteractionResolution | undefined {
  return message === undefined ? undefined : { decision: "deny", message };
}
