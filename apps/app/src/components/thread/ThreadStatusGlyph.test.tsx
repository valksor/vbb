// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk";
import { experimental_resolveThreadStatus } from "@get-bb/plugin-sdk/internal/thread-status";
import {
  SIDEBAR_ACTIVITY_STATUS_COLOR_CLASSES,
  SIDEBAR_RUNTIME_STATUS_COLOR_CLASS,
  SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
  SIDEBAR_WAITING_STATUS_COLOR_CLASS,
} from "@bb/shared-ui/sidebar-row-classes";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { toThreadStatusThread } from "@/lib/plugin-sidebar-threads";
import { ThreadStatusGlyph } from "./ThreadStatusGlyph";

afterEach(() => {
  cleanup();
});

describe("ThreadStatusGlyph", () => {
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

  it.each([
    ["unread-error", "Unread thread failed", "CircleX"],
    ["queued-failed", "Queued message failed to send", "CircleX"],
    ["waiting-for-input", "Thread needs user input", "CircleQuestion"],
    ["waiting-for-plan-approval", "Thread needs plan approval", "FileQuestion"],
    [
      "waiting-for-answer",
      "Thread is waiting for your answer",
      "MessageQuestion",
    ],
    ["queued-waiting", "Thread has a message waiting to send", "Clock"],
    ["working-draft", "Thread working with unsubmitted draft", "Edit"],
    ["workflow", "Workflow running", "Workflow"],
    ["background-agent", "Background agent running", "UserRoundPlus"],
    ["background-command", "Background command running", "Terminal"],
    ["plan-mode", "Plan mode active", "ListTodo"],
    ["goal", "Goal active", "Target"],
    ["runtime", "Thread working", "Loading"],
    ["draft", "Thread has unsubmitted draft", "Edit"],
  ] satisfies [PluginSidebarThreadIndicator, string, string][])(
    "draws %s as a labelled %s glyph",
    (indicator, label, icon) => {
      render(<ThreadStatusGlyph indicator={indicator} />);

      expect(screen.getByLabelText(label).getAttribute("data-icon")).toBe(icon);
    },
  );

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

  it("shimmers named work and spins the runtime glyph unless motion is reduced", () => {
    const { rerender } = render(<ThreadStatusGlyph indicator="workflow" />);
    const workflow = screen.getByLabelText("Workflow running");
    expect(Array.from(workflow.classList)).toContain("animate-shine-icon");
    expect(Array.from(workflow.classList)).toContain(
      SIDEBAR_ACTIVITY_STATUS_COLOR_CLASSES.workflow,
    );

    rerender(<ThreadStatusGlyph indicator="runtime" />);
    const runtime = screen.getByLabelText("Thread working");
    expect(Array.from(runtime.classList)).toContain("animate-spin");
    expect(Array.from(runtime.classList)).toContain("motion-reduce:animate-none");
    expect(Array.from(runtime.classList)).toContain(
      SIDEBAR_RUNTIME_STATUS_COLOR_CLASS,
    );
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

  it("draws unread success as a dot and nothing for none", () => {
    const { container, rerender } = render(
      <ThreadStatusGlyph indicator="unread-success" />,
    );
    const dot = screen.getByLabelText("Unread thread succeeded");
    expect(dot.tagName).toBe("SPAN");
    expect(dot.classList).toContain("size-1.5");
    expect(dot.classList).toContain("bg-success");
    expect(dot.classList).toContain("max-md:pointer-coarse:size-2");
    expect(dot.classList).not.toContain("size-[5px]");
    expect(dot.classList).not.toContain("bg-muted-foreground/60");

    rerender(<ThreadStatusGlyph indicator="none" />);
    expect(container.firstChild).toBeNull();
  });

  it("hides the idle draft glyph from assistive technology on request", () => {
    const { container } = render(
      <ThreadStatusGlyph indicator="draft" hideIdleDraftLabel />,
    );

    const draft = container.querySelector('[data-icon="Edit"]');
    expect(draft?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByLabelText("Thread has unsubmitted draft")).toBeNull();
  });

  it("draws the archive glyph for archived threads", () => {
    render(<ThreadStatusGlyph indicator="runtime" archived />);

    expect(screen.getByLabelText("Archived thread").getAttribute("data-icon")).toBe(
      "Archive",
    );
  });

  it.each([
    ["running", "animate-shine-icon"],
    ["success", SIDEBAR_SUCCESS_STATUS_COLOR_CLASS],
    ["error", "text-destructive"],
  ] as const)("draws a %s row status with its tone", (tone, className) => {
    render(
      <ThreadStatusGlyph
        indicator="draft"
        rowStatus={{ icon: "AiContentGenerator01", label: "Improving", tone }}
      />,
    );

    const status = screen.getByLabelText("Improving");
    expect(status.getAttribute("data-icon")).toBe("AiContentGenerator01");
    expect(Array.from(status.classList)).toContain(className);
    expect(screen.queryByLabelText("Thread has unsubmitted draft")).toBeNull();
  });

  it.each([
    ["runtime", "Thread working"],
    ["unread-error", "Unread thread failed"],
    ["waiting-for-input", "Thread needs user input"],
    ["waiting-for-plan-approval", "Thread needs plan approval"],
    ["waiting-for-answer", "Thread is waiting for your answer"],
  ] satisfies [PluginSidebarThreadIndicator, string][])(
    "keeps %s ahead of a row status",
    (indicator, label) => {
      render(
        <ThreadStatusGlyph
          indicator={indicator}
          rowStatus={{ icon: "AiContentGenerator01", label: "Improving" }}
        />,
      );

      expect(screen.getByLabelText(label)).not.toBeNull();
      expect(screen.queryByLabelText("Improving")).toBeNull();
    },
  );
});
