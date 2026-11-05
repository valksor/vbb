import type { ProviderPendingInteraction } from "@bb/domain";

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
