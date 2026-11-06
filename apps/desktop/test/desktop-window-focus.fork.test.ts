import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BB_DESKTOP_FOCUS_WINDOW_CHANNEL } from "../src/desktop-window-command-ipc.js";
import { registerDesktopWindowFocusIpc } from "../src/desktop-window-focus.js";

const mock = vi.hoisted(() => {
  const listeners = new Map<
    string,
    (event: { sender: { id: number } }) => void
  >();
  const window = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  return {
    appFocus: vi.fn(),
    listeners,
    window,
    fromWebContents: vi.fn((_sender: { id: number }) => window),
    on: vi.fn(
      (
        channel: string,
        listener: (event: { sender: { id: number } }) => void,
      ) => {
        listeners.set(channel, listener);
      },
    ),
  };
});

vi.mock("electron", () => ({
  app: { focus: mock.appFocus, isPackaged: false },
  BrowserWindow: { fromWebContents: mock.fromWebContents },
  ipcMain: { on: mock.on },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.window.isDestroyed.mockReturnValue(false);
  mock.window.isMinimized.mockReturnValue(false);
  mock.fromWebContents.mockReturnValue(mock.window);
  registerDesktopWindowFocusIpc(new Set([42, 43]));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function request(id: number) {
  mock.listeners.get(BB_DESKTOP_FOCUS_WINDOW_CHANNEL)?.({ sender: { id } });
}

describe("desktop notification window activation", () => {
  it("does not reveal the window while headless", () => {
    vi.stubEnv("BB_DESKTOP_HEADLESS", "1");
    mock.window.isMinimized.mockReturnValue(true);
    request(42);
    expect(mock.window.restore).not.toHaveBeenCalled();
    expect(mock.window.show).not.toHaveBeenCalled();
    expect(mock.window.focus).not.toHaveBeenCalled();
    expect(mock.appFocus).not.toHaveBeenCalled();
  });
});
