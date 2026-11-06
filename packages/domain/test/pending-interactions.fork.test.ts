import { describe, expect, it } from "vitest";
import {
  APPROVAL_DENY_MESSAGE_MAX_LENGTH,
  approvalPendingInteractionResolutionSchema,
  classifyPendingInteractionKind,
} from "../src/index.js";

describe("pending interaction schemas", () => {
  it("parses approval deny resolutions with an optional message", () => {
    expect(
      approvalPendingInteractionResolutionSchema.parse({
        decision: "deny",
        message: "held for review",
      }),
    ).toEqual({ decision: "deny", message: "held for review" });
    expect(
      approvalPendingInteractionResolutionSchema.parse({
        decision: "deny",
        message: "  padded  ",
      }),
    ).toEqual({ decision: "deny", message: "  padded  " });
    expect(
      approvalPendingInteractionResolutionSchema.parse({ decision: "deny" }),
    ).toEqual({ decision: "deny" });
    expect(() =>
      approvalPendingInteractionResolutionSchema.parse({
        decision: "deny",
        message: "",
      }),
    ).toThrow();
    expect(() =>
      approvalPendingInteractionResolutionSchema.parse({
        decision: "deny",
        message: "   ",
      }),
    ).toThrow("Approval deny message cannot be blank");
    expect(() =>
      approvalPendingInteractionResolutionSchema.parse({
        decision: "deny",
        message: "x".repeat(APPROVAL_DENY_MESSAGE_MAX_LENGTH + 1),
      }),
    ).toThrow(
      `Approval deny message cannot exceed ${APPROVAL_DENY_MESSAGE_MAX_LENGTH} characters`,
    );
  });
});

describe("classifyPendingInteractionKind", () => {
  const cases: Array<
    [
      payloadKind: string | null,
      approvalSubjectKind: string | null,
      expected: "plan_approval" | "question" | "approval",
    ]
  > = [
    ["approval", "plan", "plan_approval"],
    ["approval", "command", "approval"],
    ["approval", "file_change", "approval"],
    ["approval", "permission_grant", "approval"],
    ["approval", "tool_use", "approval"],
    ["approval", "mystery_subject", "approval"],
    ["approval", null, "approval"],
    ["user_question", null, "question"],
    ["plugin", null, "question"],
    ["my-plugin/form", null, "question"],
    ["provider-x/ask", "plan", "question"],
    [null, null, "approval"],
    [null, "plan", "approval"],
    ["mystery", null, "approval"],
    ["mystery", "plan", "approval"],
  ];

  it.each(cases)(
    "classifies payload kind %p with subject kind %p as %p",
    (payloadKind, approvalSubjectKind, expected) => {
      expect(
        classifyPendingInteractionKind({ payloadKind, approvalSubjectKind }),
      ).toBe(expected);
    },
  );

  it("classifies extension-kind-adjacent odd inputs as the generic approval", () => {
    expect(
      classifyPendingInteractionKind({
        payloadKind: "a/b/c",
        approvalSubjectKind: null,
      }),
    ).toBe("approval");
    expect(
      classifyPendingInteractionKind({
        payloadKind: "APPROVAL",
        approvalSubjectKind: null,
      }),
    ).toBe("approval");
    expect(
      classifyPendingInteractionKind({
        payloadKind: "user_question/",
        approvalSubjectKind: null,
      }),
    ).toBe("approval");
  });
});
