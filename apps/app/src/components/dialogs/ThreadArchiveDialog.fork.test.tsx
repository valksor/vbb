// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeThread } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadArchiveDialog } from "./ThreadArchiveDialog";

afterEach(() => {
  cleanup();
});

function renderDialog({
  childThreadCount = 1,
  environmentId,
  pending = false,
  stopsRunningWork = false,
}: {
  childThreadCount?: number;
  environmentId?: string;
  pending?: boolean;
  stopsRunningWork?: boolean;
} = {}) {
  const onArchive = vi.fn();
  const onOpenChange = vi.fn();
  const thread = makeThread();
  const view = render(
    <ThreadArchiveDialog
      target={{
        threads: [thread],
        childThreadCount,
        stopsRunningWork,
        ...(environmentId !== undefined ? { environmentId } : {}),
      }}
      pending={pending}
      onOpenChange={onOpenChange}
      onArchive={onArchive}
    />,
  );
  return { onArchive, onOpenChange, thread, view };
}

describe("ThreadArchiveDialog", () => {
  it("drops the children sentence when there are no child threads", () => {
    renderDialog({ childThreadCount: 0 });
    const description = screen.getByRole("dialog").textContent;
    expect(description).not.toContain("will be archived too");
    expect(description).not.toContain("Its");
    expect(description).toContain(
      "Archived threads stay available and can be unarchived.",
    );
  });

  it("uses the environment title and copy for an environment archive", () => {
    renderDialog({
      childThreadCount: 0,
      environmentId: "env_test",
      stopsRunningWork: true,
    });

    expect(
      screen.getByRole("heading", {
        name: "Archive all threads in this environment?",
      }),
    ).toBeTruthy();
    const description = screen.getByRole("dialog").textContent;
    expect(description).toContain("This will stop current work.");
    expect(description).toContain("Child threads are archived too.");
    expect(description).toContain(
      "All threads in this environment stay available and can be unarchived.",
    );
    expect(description).not.toContain("will be archived too");
    expect(description).not.toContain("Its");
  });

  it("focuses cancel when the archive stops running work", () => {
    renderDialog({ stopsRunningWork: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("ignores confirmation while an environment archive is pending", () => {
    const { onArchive } = renderDialog({
      environmentId: "env_test",
      pending: true,
      stopsRunningWork: true,
    });
    const archive = screen.getByRole("button", { name: "Archive" });
    expect(archive.hasAttribute("disabled")).toBe(true);
    fireEvent.click(archive);
    expect(onArchive).not.toHaveBeenCalled();
  });
});
