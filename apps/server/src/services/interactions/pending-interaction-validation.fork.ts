import { ApiError } from "../../errors.js";

export function assertDenyMessageAllowed(
  interaction: { payload: { subject: { kind: string } } },
  resolution: { decision: string; message?: string },
): void {
  if (
    resolution.decision === "deny" &&
    resolution.message !== undefined &&
    interaction.payload.subject.kind !== "plan"
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "A deny message is only accepted for plan approvals",
    );
  }
}
