import { z } from "zod";
import { isExtensionKind } from "./provider-extension-kind.js";

export const threadPendingInteractionKindSchema = z.enum([
  "plan_approval",
  "question",
  "approval",
]);
export type ThreadPendingInteractionKind = z.infer<
  typeof threadPendingInteractionKindSchema
>;

export type PendingInteractionKindInputs = {
  payloadKind: string | null;
  approvalSubjectKind: string | null;
};

export function classifyPendingInteractionKind(
  inputs: PendingInteractionKindInputs,
): ThreadPendingInteractionKind {
  if (inputs.payloadKind === null) {
    return "approval";
  }
  if (inputs.payloadKind === "approval") {
    return inputs.approvalSubjectKind === "plan" ? "plan_approval" : "approval";
  }
  if (
    inputs.payloadKind === "user_question" ||
    inputs.payloadKind === "plugin" ||
    isExtensionKind(inputs.payloadKind)
  ) {
    return "question";
  }
  return "approval";
}

export const APPROVAL_DENY_MESSAGE_MAX_LENGTH = 4096;

export const pendingInteractionApprovalDenyMessageSchema = z
  .string()
  .min(1)
  .max(
    APPROVAL_DENY_MESSAGE_MAX_LENGTH,
    `Approval deny message cannot exceed ${APPROVAL_DENY_MESSAGE_MAX_LENGTH} characters`,
  )
  .refine((value) => value.trim().length > 0, {
    message: "Approval deny message cannot be blank",
  });
