import { describe, expect, it } from "vitest";
import {
  reportTurnExecution,
  toCodexExecutionDelta,
} from "./execution-report.js";
import type { CodexSessionOptions } from "./session-params.js";

const AUTO_SESSION_OPTIONS = {
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} satisfies CodexSessionOptions;

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

  it.each([
    ["full", "dangerFullAccess", "never", undefined, "full"],
    ["auto", "workspaceWrite", "on-request", "auto_review", "auto"],
    ["accept-edits", "workspaceWrite", "on-request", "user", "accept-edits"],
    ["unmapped", "readOnly", "never", "user", null],
  ])(
    "maps %s permission settings",
    (_name, sandboxType, approvalPolicy, approvalsReviewer, permissionMode) => {
      expect(
        toCodexExecutionDelta({
          model: "gpt-5.6-sol",
          sandbox: { type: sandboxType },
          approvalPolicy,
          approvalsReviewer,
        }),
      ).toMatchObject({ execution: { permissionMode } });
    },
  );

  it.each([
    ["absent", undefined, null],
    ["explicit null", null, "default"],
    ["provider-defined", "flex", "flex"],
  ])("maps %s service tier", (_name, serviceTier, expected) => {
    expect(
      toCodexExecutionDelta({ model: "gpt-5.6-sol", serviceTier }),
    ).toMatchObject({ execution: { serviceTier: expected } });
  });
});

describe("reportTurnExecution", () => {
  it("does not fabricate an execution report without a prior construction report", () => {
    const sent: unknown[] = [];
    reportTurnExecution(
      { lastReportedExecution: null },
      AUTO_SESSION_OPTIONS,
      {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandboxPolicy: { type: "workspaceWrite" },
      },
      (_session, deltas) => sent.push(deltas),
    );
    expect(sent).toEqual([]);
  });

  it("retains omitted settings and prior reasoning, then suppresses an unchanged report", () => {
    const session = {
      lastReportedExecution: {
        model: "gpt-5.5",
        reasoningLevel: "medium" as const,
        permissionMode: "auto" as const,
        serviceTier: "default",
      },
    };
    const sent: unknown[] = [];
    const permissionSettings = {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxPolicy: { type: "workspaceWrite" },
    };

    reportTurnExecution(
      session,
      AUTO_SESSION_OPTIONS,
      permissionSettings,
      (_session, deltas) => sent.push(deltas),
    );
    expect(sent).toEqual([]);

    reportTurnExecution(
      session,
      { ...AUTO_SESSION_OPTIONS, model: "gpt-5.5-mini", serviceTier: "fast" },
      permissionSettings,
      (_session, deltas) => sent.push(deltas),
    );
    expect(session.lastReportedExecution).toEqual({
      model: "gpt-5.5-mini",
      reasoningLevel: "medium",
      permissionMode: "auto",
      serviceTier: "fast",
    });
    expect(sent).toHaveLength(1);

    reportTurnExecution(
      session,
      { ...AUTO_SESSION_OPTIONS, model: "gpt-5.5-mini", serviceTier: "fast" },
      permissionSettings,
      (_session, deltas) => sent.push(deltas),
    );
    expect(sent).toHaveLength(1);
  });
});
