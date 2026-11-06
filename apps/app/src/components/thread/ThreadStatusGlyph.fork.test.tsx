// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { experimental_resolveThreadStatus } from "@get-bb/plugin-sdk/internal/thread-status";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { toThreadStatusThread } from "@/lib/plugin-sidebar-threads";
import {
  SIDEBAR_ACTIVITY_STATUS_COLOR_CLASSES,
  SIDEBAR_WAITING_STATUS_COLOR_CLASS,
} from "@bb/shared-ui/sidebar-row-classes";
import { ThreadStatusGlyph } from "./ThreadStatusGlyph";

afterEach(() => {
  cleanup();
});

describe("ThreadStatusGlyph", () => {
  it.each([
    ["workflow", "Workflow running"],
    ["background-agent", "Background agent running"],
    ["background-command", "Background command running"],
    ["plan-mode", "Plan mode active"],
    ["goal", "Goal active"],
  ] as const)("colors the %s glyph with its activity color", (indicator, label) => {
    render(<ThreadStatusGlyph indicator={indicator} />);

    const classes = Array.from(screen.getByLabelText(label).classList);
    expect(classes).toContain("animate-shine-icon");
    expect(classes).toContain(SIDEBAR_ACTIVITY_STATUS_COLOR_CLASSES[indicator]);
  });

  it.each([
    ["waiting-for-input", "Thread needs user input"],
    ["waiting-for-plan-approval", "Thread needs plan approval"],
    ["waiting-for-answer", "Thread is waiting for your answer"],
  ] as const)("colors the %s glyph with the waiting color", (indicator, label) => {
    render(<ThreadStatusGlyph indicator={indicator} />);

    expect(
      Array.from(screen.getByLabelText(label).classList),
    ).toContain(SIDEBAR_WAITING_STATUS_COLOR_CLASS);
  });
});

it("renders workflow activity from thread metadata with its source color", () => {
    const status = experimental_resolveThreadStatus({
      thread: toThreadStatusThread(
        makeThreadListEntry({
          activity: { activeWorkflowCount: 1 },
          runtime: { displayStatus: "idle" },
          status: "idle",
          lastReadAt: 0,
          latestAttentionAt: 0,
          hasPendingInteraction: false,
        }),
      ),
      hiddenThreads: [],
      hasUnsubmittedDraft: false,
      rowStatus: null,
    });

    render(<ThreadStatusGlyph indicator={status.indicator} />);

    expect(screen.getByLabelText("Workflow running").getAttribute("data-icon")).toBe(
      "Workflow",
    );
    expect(
      Array.from(screen.getByLabelText("Workflow running").classList),
    ).toContain("animate-shine-icon");
    expect(
      Array.from(screen.getByLabelText("Workflow running").classList),
    ).toContain("text-working-workflow");
  });

it("renders plan approval from existing thread metadata", () => {
    const status = experimental_resolveThreadStatus({
      thread: toThreadStatusThread(
        makeThreadListEntry({
          hasPendingInteraction: true,
          pendingInteractionKind: "plan_approval",
        }),
      ),
      hiddenThreads: [],
      hasUnsubmittedDraft: false,
      rowStatus: null,
    });

    render(<ThreadStatusGlyph indicator={status.indicator} />);

    expect(
      screen.getByLabelText("Thread needs plan approval").getAttribute("data-icon"),
    ).toBe("FileQuestion");
  });
