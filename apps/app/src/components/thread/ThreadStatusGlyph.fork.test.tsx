// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
