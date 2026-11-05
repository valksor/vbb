// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type {
  OpenInTargetRequest,
  WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import type { StoredWorkspaceOpenTargetPreference } from "@/lib/workspace-open-target-preference";
import {
  TERMINAL_RUN_TARGET_STORAGE_KEY,
  terminalRunTargetPreferenceAtom,
} from "@/lib/workspace-open-target-preference.fork";
import { useLocalOpenTargets } from "./useLocalOpenTargets";

const mocks = vi.hoisted(() => ({
  openInTarget: vi.fn(),
  workspaceOpenTargets: [] as WorkspaceOpenTarget[],
}));

vi.mock("@/lib/api-host-daemon", () => ({
  fetchWorkspaceOpenTargets: vi.fn(),
  openInTarget: mocks.openInTarget,
}));

vi.mock("@/lib/system-config-atoms", async () => {
  const { atom } = await import("jotai");
  return {
    hostDaemonPortAtom: atom(49_152),
    localHostDaemonAccessStateAtom: atom("granted"),
    localHostDaemonHostIdAtom: atom("host-local"),
    localHostDaemonReachableAtom: atom(true),
    localHostIdAtom: atom("host-local"),
    localHostStatusAtom: atom(null),
    localWorkspaceOpenTargetsAtom: atom(() => mocks.workspaceOpenTargets),
    requestLocalHostDaemonAccessAtom: atom(null, () => {}),
  };
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(TERMINAL_RUN_TARGET_STORAGE_KEY);
  mocks.openInTarget.mockReset();
  vi.restoreAllMocks();
});

const EDITOR_TARGET: WorkspaceOpenTarget = {
  id: "vscode",
  label: "VS Code",
  kind: "editor",
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtColumn: true,
    openFileAtLine: true,
  },
};

const TERMINAL_TARGET: WorkspaceOpenTarget = {
  id: "terminal",
  label: "Terminal",
  kind: "terminal",
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtColumn: true,
    openFileAtLine: true,
    runCommand: true,
  },
};

const ITERM_TARGET: WorkspaceOpenTarget = {
  id: "iterm2",
  label: "iTerm2",
  kind: "terminal",
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtColumn: true,
    openFileAtLine: true,
    runCommand: true,
  },
};

const WARP_TARGET: WorkspaceOpenTarget = {
  id: "warp",
  label: "Warp",
  kind: "terminal",
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtColumn: true,
    openFileAtLine: true,
  },
};

const DEFAULT_APP_TARGET: WorkspaceOpenTarget = {
  id: "default-app",
  label: "Default App",
  kind: "default-app",
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtColumn: true,
    openFileAtLine: true,
  },
};

function renderLocalOpenTargets(
  initialValues?: ReadonlyArray<
    readonly [
      typeof terminalRunTargetPreferenceAtom,
      StoredWorkspaceOpenTargetPreference,
    ]
  >,
) {
  const store = createStore();
  for (const [preferenceAtom, preferenceValue] of initialValues ?? []) {
    store.set(preferenceAtom, preferenceValue);
  }
  return renderHook(
    () =>
      useLocalOpenTargets({
        enabled: true,
        openContext: { kind: "local" },
      }),
    {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    },
  );
}

async function runCommand(
  hook: ReturnType<typeof renderLocalOpenTargets>["result"],
  args?: { command?: string; cwd?: string; language?: "bash" },
) {
  await act(async () => {
    await hook.current.runCommandInPreferredTerminalTarget({
      command: args?.command ?? "npm test",
      cwd: args?.cwd ?? "/workspace",
      ...(args?.language === undefined ? {} : { language: args.language }),
    });
  });
}

describe("useLocalOpenTargets run command", () => {
  it("pins the composed request body on the first run-command target", async () => {
    mocks.workspaceOpenTargets = [EDITOR_TARGET, TERMINAL_TARGET, ITERM_TARGET];
    mocks.openInTarget.mockResolvedValue(undefined);
    const { result } = renderLocalOpenTargets();

    expect(result.current.runCommandTarget).toBe(TERMINAL_TARGET);
    await runCommand(result, { language: "bash" });

    expect(mocks.openInTarget).toHaveBeenCalledTimes(1);
    expect(mocks.openInTarget).toHaveBeenCalledWith(49_152, {
      columnNumber: null,
      command: "npm test",
      context: { kind: "local" },
      language: "bash",
      lineNumber: null,
      path: "/workspace",
      targetId: "terminal",
    } satisfies OpenInTargetRequest);
  });

  it("omits the language key so the daemon default applies", async () => {
    mocks.workspaceOpenTargets = [TERMINAL_TARGET];
    mocks.openInTarget.mockResolvedValue(undefined);
    const { result } = renderLocalOpenTargets();

    await runCommand(result);

    const body = mocks.openInTarget.mock.calls[0]?.[1] as OpenInTargetRequest;
    expect("language" in body).toBe(false);
    expect(body).toEqual({
      columnNumber: null,
      command: "npm test",
      context: { kind: "local" },
      lineNumber: null,
      path: "/workspace",
      targetId: "terminal",
    });
  });

  it("reports success with the target terminal label", async () => {
    mocks.workspaceOpenTargets = [TERMINAL_TARGET];
    mocks.openInTarget.mockResolvedValue(undefined);
    const successToast = vi.spyOn(appToast, "success");
    const { result } = renderLocalOpenTargets();

    let dispatched = false;
    await act(async () => {
      dispatched = await result.current.runCommandInPreferredTerminalTarget({
        command: "npm test",
        cwd: "/workspace",
      });
    });

    expect(dispatched).toBe(true);
    expect(successToast).toHaveBeenCalledWith("Command sent to Terminal");
  });

  it("keeps the runner referentially stable across rerenders", async () => {
    mocks.workspaceOpenTargets = [TERMINAL_TARGET];
    const { result, rerender } = renderLocalOpenTargets();
    const initialRunner = result.current.runCommandInPreferredTerminalTarget;

    rerender();

    expect(result.current.runCommandInPreferredTerminalTarget).toBe(
      initialRunner,
    );
  });

  it("toasts an unavailable daemon when the open path is missing", async () => {
    mocks.workspaceOpenTargets = [];
    const errorToast = vi.spyOn(appToast, "error");
    const { result } = renderLocalOpenTargets();

    expect(result.current.runCommandTarget).toBeNull();
    let dispatched = true;
    await act(async () => {
      dispatched = await result.current.runCommandInPreferredTerminalTarget({
        command: "npm test",
        cwd: "/workspace",
      });
    });
    expect(dispatched).toBe(false);
    expect(errorToast).toHaveBeenCalledWith(
      "Failed to run command in terminal",
      {
        description: "Local host daemon is unavailable.",
      },
    );
  });

  it("toasts a human-readable description when only non-run targets are installed", async () => {
    mocks.workspaceOpenTargets = [EDITOR_TARGET, WARP_TARGET];
    const errorToast = vi.spyOn(appToast, "error");
    const { result } = renderLocalOpenTargets();

    expect(result.current.runCommandTarget).toBeNull();
    let dispatched = true;
    await act(async () => {
      dispatched = await result.current.runCommandInPreferredTerminalTarget({
        command: "npm test",
        cwd: "/workspace",
      });
    });

    expect(dispatched).toBe(false);
    expect(errorToast).toHaveBeenCalledWith(
      "Failed to run command in terminal",
      {
        description: "No local terminal can run commands.",
      },
    );
  });

  it("never forwards a raw daemon error string on a 400 response", async () => {
    mocks.workspaceOpenTargets = [TERMINAL_TARGET];
    mocks.openInTarget.mockRejectedValue(
      new Error("open-in-target: malformed command for target terminal"),
    );
    const errorToast = vi.spyOn(appToast, "error");
    const { result } = renderLocalOpenTargets();

    let dispatched = true;
    await act(async () => {
      dispatched = await result.current.runCommandInPreferredTerminalTarget({
        command: "npm test",
        cwd: "/workspace",
      });
    });

    expect(dispatched).toBe(false);
    expect(errorToast).toHaveBeenCalledTimes(1);
    expect(errorToast).toHaveBeenCalledWith(
      "Failed to run command in terminal",
      {
        description: "The local daemon could not run the command.",
      },
    );
  });

  it("resolves no run target for a remote-ssh workspace context", async () => {
    mocks.workspaceOpenTargets = [TERMINAL_TARGET];
    const errorToast = vi.spyOn(appToast, "error");
    const { result } = renderHook(
      () =>
        useLocalOpenTargets({
          enabled: true,
          openContext: {
            kind: "remote-ssh",
            hostId: "host-1",
            serverOrigin: "https://bb.example.test",
          },
        }),
      {
        wrapper: ({ children }) => <Provider>{children}</Provider>,
      },
    );

    expect(result.current.runCommandTarget).toBeNull();
    let dispatched = true;
    await act(async () => {
      dispatched = await result.current.runCommandInPreferredTerminalTarget({
        command: "npm test",
        cwd: "/workspace",
      });
    });

    expect(dispatched).toBe(false);
    expect(mocks.openInTarget).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith(
      "Failed to run command in terminal",
      {
        description: "No local terminal can run commands.",
      },
    );
  });

  it("pins the composed request body on the preferred run-command target", async () => {
    mocks.workspaceOpenTargets = [EDITOR_TARGET, TERMINAL_TARGET, ITERM_TARGET];
    mocks.openInTarget.mockResolvedValue(undefined);
    const { result } = renderLocalOpenTargets([
      [terminalRunTargetPreferenceAtom, "iterm2"],
    ]);

    expect(result.current.runCommandTarget).toBe(ITERM_TARGET);
    await runCommand(result);

    expect(mocks.openInTarget).toHaveBeenCalledTimes(1);
    expect(mocks.openInTarget).toHaveBeenCalledWith(49_152, {
      columnNumber: null,
      command: "npm test",
      context: { kind: "local" },
      lineNumber: null,
      path: "/workspace",
      targetId: "iterm2",
    } satisfies OpenInTargetRequest);
  });

  it("falls back when the stored run-command target is unknown and keeps the stored value", async () => {
    mocks.workspaceOpenTargets = [TERMINAL_TARGET, DEFAULT_APP_TARGET];
    mocks.openInTarget.mockResolvedValue(undefined);
    const { result } = renderLocalOpenTargets([
      [terminalRunTargetPreferenceAtom, "iterm2"],
    ]);

    expect(result.current.runCommandTarget).toBe(TERMINAL_TARGET);
    await runCommand(result);

    expect(mocks.openInTarget).toHaveBeenCalledTimes(1);
    expect(mocks.openInTarget).toHaveBeenCalledWith(49_152, {
      columnNumber: null,
      command: "npm test",
      context: { kind: "local" },
      lineNumber: null,
      path: "/workspace",
      targetId: "terminal",
    } satisfies OpenInTargetRequest);
    expect(localStorage.getItem(TERMINAL_RUN_TARGET_STORAGE_KEY)).toBe(
      "iterm2",
    );
  });

  it("falls back when the stored run-command target cannot run commands", async () => {
    mocks.workspaceOpenTargets = [TERMINAL_TARGET, DEFAULT_APP_TARGET];
    mocks.openInTarget.mockResolvedValue(undefined);
    const { result } = renderLocalOpenTargets([
      [terminalRunTargetPreferenceAtom, "default-app"],
    ]);

    expect(result.current.runCommandTarget).toBe(TERMINAL_TARGET);
    await runCommand(result);

    expect(mocks.openInTarget).toHaveBeenCalledTimes(1);
    expect(mocks.openInTarget).toHaveBeenCalledWith(49_152, {
      columnNumber: null,
      command: "npm test",
      context: { kind: "local" },
      lineNumber: null,
      path: "/workspace",
      targetId: "terminal",
    } satisfies OpenInTargetRequest);
  });
});
