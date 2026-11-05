// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchivedThreadToastWithNote } from "./ArchivedThreadToastWithNote";

afterEach(() => {
  cleanup();
});

describe("ArchivedThreadToastWithNote", () => {
  it("renders the undo note as a muted second line when stopped work was archived", () => {
    render(
      <ArchivedThreadToastWithNote
        archivedThreadCount={1}
        note="Undo restores it with partial output."
        onOpenThread={vi.fn()}
        threadTitle="Investigate provider timeouts"
      />,
    );

    const note = screen.getByText("Undo restores it with partial output.");
    expect(note.className).toContain("text-muted-foreground");
  });
});
