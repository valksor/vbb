// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ShellCommandRunDrawer,
  type ShellCommandRunPrompt,
} from "./ShellCommandRunDrawer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockPointerCoarse() {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === POINTER_COARSE_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

const PROMPT: ShellCommandRunPrompt = {
  command: "npm install\nnpx biome check .",
  language: "bash",
};

function renderDrawer(
  args: {
    prompt?: ShellCommandRunPrompt | null;
    onConfirm?: (prompt: ShellCommandRunPrompt) => void;
    onDismiss?: () => void;
  } = {},
) {
  mockPointerCoarse();
  const onConfirm = args.onConfirm ?? vi.fn();
  const onDismiss = args.onDismiss ?? vi.fn();
  render(
    <ShellCommandRunDrawer
      cwd="/workspace/project"
      targetLabel="Terminal"
      prompt={args.prompt === undefined ? PROMPT : args.prompt}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />,
  );
  return { onConfirm, onDismiss };
}

describe("ShellCommandRunDrawer", () => {
  it("renders the command with bidi control characters stripped", async () => {
    renderDrawer({
      prompt: {
        command: "echo ‪injected‬ && ls",
        language: "sh",
      },
    });

    const commandRegion = await screen.findByLabelText("Command to run");
    expect(commandRegion.getAttribute("role")).toBe("region");
    expect(commandRegion.getAttribute("tabindex")).toBe("0");
    expect(commandRegion.textContent).toBe("echo injected && ls");
  });

  it("shows the working directory and the target terminal label", async () => {
    mockPointerCoarse();
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ShellCommandRunDrawer
        cwd="/workspace/project"
        targetLabel="Ghostty"
        prompt={PROMPT}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );

    await screen.findByLabelText("Command to run");
    expect(screen.getByText("/workspace/project")).toBeTruthy();
    expect(screen.getByText("Ghostty")).toBeTruthy();
    expect(screen.getByText("Terminal", { selector: "dt" })).toBeTruthy();
  });

  it("confirms with the pending prompt without dismissing itself", async () => {
    const onDismiss = vi.fn();
    const { onConfirm } = renderDrawer({ onDismiss });

    fireEvent.click(
      await screen.findByRole("button", { name: "Run in terminal" }),
    );

    expect(onConfirm).toHaveBeenCalledWith(PROMPT);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses via Cancel without confirming", async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    renderDrawer({ onConfirm, onDismiss });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("dismisses via Escape without confirming", async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    renderDrawer({ onConfirm, onDismiss });

    await screen.findByLabelText("Command to run");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders no drawer while no prompt is pending", () => {
    renderDrawer({ prompt: null });

    expect(
      document.querySelector("[data-persistent-drawer-content]"),
    ).toBeNull();
  });
});
