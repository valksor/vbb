// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminalRunTargetPreferenceAtom } from "@/lib/workspace-open-target-preference.fork";
import { LocalOpenTargetSettingsSection } from "./SettingsView";

const vscodeTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "vscode",
  kind: "editor",
  label: "VS Code",
};

const terminalTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
    runCommand: true,
  },
  id: "terminal",
  kind: "terminal",
  label: "Terminal",
};

const defaultAppTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "default-app",
  kind: "default-app",
  label: "Default App",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSection({
  accessState,
  hasDaemon = false,
  onRequestAccess = vi.fn(async () => true),
  targets = [],
}: {
  accessState:
    | "available"
    | "denied"
    | "permission-required"
    | "unavailable"
    | "unsupported";
  hasDaemon?: boolean;
  onRequestAccess?: () => Promise<boolean>;
  targets?: WorkspaceOpenTarget[];
}) {
  const store = createStore();
  render(
    <Provider store={store}>
      <LocalOpenTargetSettingsSection
        accessState={accessState}
        directoryTargetId={null}
        fileTargetId={null}
        hasDaemon={hasDaemon}
        onDirectoryTargetChange={vi.fn()}
        onFileTargetChange={vi.fn()}
        onRequestAccess={onRequestAccess}
        targets={targets}
      />
    </Provider>,
  );
  return { onRequestAccess, store };
}

describe("LocalOpenTargetSettingsSection", () => {
  it("shows the terminal default with the editor preferences when the helper is reachable", () => {
    renderSection({
      accessState: "available",
      hasDaemon: true,
      targets: [vscodeTarget, terminalTarget, defaultAppTarget],
    });

    expect(screen.queryByText("Directory default")).not.toBeNull();
    expect(screen.queryByText("File default")).not.toBeNull();
    expect(screen.queryByText("Terminal default")).not.toBeNull();
    expect(
      screen.queryByText("No local terminal can run commands."),
    ).toBeNull();
    expect(screen.queryByText("Local editor integration")).toBeNull();
  });

  it("lists only run-capable targets in the terminal dropdown", async () => {
    const { store } = renderSection({
      accessState: "available",
      hasDaemon: true,
      targets: [vscodeTarget, terminalTarget, defaultAppTarget],
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Terminal default" }),
      { button: 0 },
    );
    const menu = await screen.findByRole("menu");
    const menuItems = within(menu);

    expect(
      menuItems.getByRole("menuitem", { name: "Terminal" }),
    ).not.toBeNull();
    expect(menuItems.queryByRole("menuitem", { name: "VS Code" })).toBeNull();
    expect(
      menuItems.queryByRole("menuitem", { name: "Default App" }),
    ).toBeNull();

    const onPreferenceChange = vi.fn();
    store.sub(terminalRunTargetPreferenceAtom, onPreferenceChange);
    fireEvent.click(menuItems.getByRole("menuitem", { name: "Terminal" }));
    expect(onPreferenceChange).toHaveBeenCalledTimes(1);
    expect(store.get(terminalRunTargetPreferenceAtom)).toBe("terminal");
  });

  it("reports the terminal dropdown unavailable without run-capable targets", async () => {
    renderSection({
      accessState: "available",
      hasDaemon: true,
      targets: [vscodeTarget],
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Terminal default" }),
      { button: 0 },
    );

    expect(
      await screen.findByText("No local terminal can run commands."),
    ).not.toBeNull();
  });
});
