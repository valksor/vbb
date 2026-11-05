import { describe, expect, it } from "vitest";
import { buildClaudeInteractiveResponse } from "./interactions.js";
import { buildClaudePlanRejectionMessage } from "./interactive-contract.js";

describe("claude-code interactive requests", () => {
  it("a plan deny with `message` returns that text", () => {
    const response = buildClaudeInteractiveResponse(
      {
        payload: {
          kind: "approval",
          reason: null,
          availableDecisions: ["allow_once", "deny"],
          subject: {
            kind: "plan",
            itemId: "toolu_plan",
            plan: "# Plan",
            planFilePath: null,
          },
        },
        resolution: {
          decision: "deny",
          message: "Drop the migration step, then propose the plan again.",
        },
      },
      [],
    );

    expect(response).toMatchObject({
      behavior: "deny",
      message: "Drop the migration step, then propose the plan again.",
    });
  });

  it("a plan deny without it returns the default", () => {
    const response = buildClaudeInteractiveResponse(
      {
        payload: {
          kind: "approval",
          reason: null,
          availableDecisions: ["allow_once", "deny"],
          subject: {
            kind: "plan",
            itemId: "toolu_plan",
            plan: "# Plan",
            planFilePath: null,
          },
        },
        resolution: { decision: "deny" },
      },
      [],
    );

    expect(response).toMatchObject({
      behavior: "deny",
      message: buildClaudePlanRejectionMessage(),
    });
  });
});
