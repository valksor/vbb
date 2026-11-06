import { describe, expect, it } from "vitest";
import { toCodexExecutionDelta } from "./execution-report.js";

describe("toCodexExecutionDelta (get-bb/bb#1787)", () => {
  it("maps the settings a resumed session resolved into bb's vocabulary", () => {
    expect(
      toCodexExecutionDelta({
        thread: { id: "codex-thread" },
        model: "gpt-5.6-sol",
        reasoningEffort: "xhigh",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: { type: "workspaceWrite", writableRoots: [] },
        serviceTier: "fast",
      }),
    ).toEqual({
      kind: "thread.execution",
      execution: {
        model: "gpt-5.6-sol",
        reasoningLevel: "xhigh",
        permissionMode: "accept-edits",
        serviceTier: "fast",
      },
    });
  });

  it("passes provider-defined service tiers through and leaves unmapped settings null", () => {
    expect(
      toCodexExecutionDelta({
        thread: { id: "codex-thread" },
        model: "gpt-5.6-sol",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: { type: "dangerFullAccess" },
        serviceTier: "flex",
      }),
    ).toEqual({
      kind: "thread.execution",
      execution: {
        model: "gpt-5.6-sol",
        reasoningLevel: null,
        permissionMode: null,
        serviceTier: "flex",
      },
    });
  });

  it("reports nothing when the response names no model", () => {
    expect(toCodexExecutionDelta({ thread: { id: "codex-thread" } })).toBe(
      null,
    );
  });
});
