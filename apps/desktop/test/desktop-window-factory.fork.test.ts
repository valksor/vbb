import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  createDesktopWindowFactory,
  type DesktopBrowserWindow,
  type DesktopBrowserWindowCreator,
  type DesktopWindowOpenHandler,
  type DesktopWindowOpenDevToolsOptions,
  type DesktopWindowWebContents,
} from "../src/desktop-window-factory.js";
import type { DesktopContextMenuWebContents } from "../src/desktop-context-menu.js";
import { readPersistedWindowStateFile } from "../src/window-state.js";
import type { WindowBounds } from "../src/types.js";

interface TempDir {
  path: string;
}

interface FakeDesktopWindowArgs {
  options: BrowserWindowConstructorOptions;
}

const tempDirs: TempDir[] = [];

async function createTempDir(): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), "bb-desktop-window-factory-"));
  const tempDir = { path };
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir !== undefined) {
      await rm(tempDir.path, { force: true, recursive: true });
    }
  }
});

class FakeDesktopWindowWebContents implements DesktopWindowWebContents {
  public devToolsOpenCount = 0;
  public id: number;
  public readonly addedDictionaryWords: string[] = [];
  public readonly spellCheckerEnabledValues: boolean[] = [];
  public readonly session: DesktopContextMenuWebContents["session"] = {
    addWordToSpellCheckerDictionary: (word) => {
      this.addedDictionaryWords.push(word);
      return true;
    },
    setSpellCheckerEnabled: (enabled) => {
      this.spellCheckerEnabledValues.push(enabled);
    },
  };
  public readonly contextMenuListeners: Parameters<
    DesktopContextMenuWebContents["on"]
  >[1][] = [];
  public readonly replacedMisspellings: string[] = [];
  public windowOpenHandler: DesktopWindowOpenHandler | null = null;
  public readonly zoomFactors: number[] = [];
  public readonly domReadyListeners: Array<() => void> = [];
  public readonly themeColorListeners: Array<
    (event: Event, color: string | null) => void
  > = [];
  public readonly ipcListeners = new Map<string, () => void>();
  public zoomFactor = 1;

  constructor(id: number) {
    this.id = id;
  }

  public readonly ipc = {
    on: (channel: string, listener: () => void) => {
      this.ipcListeners.set(channel, listener);
    },
  };

  openDevTools(options: DesktopWindowOpenDevToolsOptions): void {
    if (options.mode === "detach") {
      this.devToolsOpenCount += 1;
    }
  }

  on(eventName: "dom-ready", listener: () => void): void;
  on(...args: Parameters<DesktopContextMenuWebContents["on"]>): void;
  on(
    eventName: "did-change-theme-color",
    listener: (event: Event, color: string | null) => void,
  ): void;
  on(
    ...args:
      | ["dom-ready", () => void]
      | Parameters<DesktopContextMenuWebContents["on"]>
      | ["did-change-theme-color", (event: Event, color: string | null) => void]
  ): void {
    const [eventName, listener] = args;
    if (eventName === "context-menu") {
      this.contextMenuListeners.push(listener);
    } else if (eventName === "dom-ready") {
      this.domReadyListeners.push(listener);
    } else {
      this.themeColorListeners.push(listener);
    }
  }

  copyImageAt(): void {}

  downloadURL(): void {}

  replaceMisspelling(text: string): void {
    this.replacedMisspellings.push(text);
  }

  setWindowOpenHandler(handler: DesktopWindowOpenHandler): void {
    this.windowOpenHandler = handler;
  }

  getZoomFactor(): number {
    return this.zoomFactor;
  }

  setZoomFactor(factor: number): void {
    this.zoomFactor = factor;
    this.zoomFactors.push(factor);
  }
}

class FakeDesktopWindow implements DesktopBrowserWindow {
  public readonly id: number;
  public readonly loadedUrls: string[] = [];
  public readonly options: BrowserWindowConstructorOptions;
  public readonly webContents: FakeDesktopWindowWebContents;
  public backgroundColor: string;
  public focusCalls = 0;
  public windowButtonPositions: Array<{ x: number; y: number }> = [];
  public fullScreen = false;
  public maximized = false;
  public minimized = false;
  public shown = false;
  private destroyed = false;
  public bounds: WindowBounds;
  public normalBounds: WindowBounds | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();
  private readonly closedListeners: Array<() => void> = [];
  private readyToShowListener: (() => void) | null = null;

  constructor(args: FakeDesktopWindowArgs) {
    this.options = args.options;
    this.backgroundColor = args.options.backgroundColor ?? "#ffffff";
    this.id = FakeDesktopWindow.nextWindowId;
    FakeDesktopWindow.nextWindowId += 1;
    this.webContents = new FakeDesktopWindowWebContents(
      FakeDesktopWindow.nextWebContentsId,
    );
    FakeDesktopWindow.nextWebContentsId += 1;
    this.bounds = {
      height: args.options.height ?? 0,
      width: args.options.width ?? 0,
      x: args.options.x ?? 0,
      y: args.options.y ?? 0,
    };
  }

  private static nextWindowId = 1;
  private static nextWebContentsId = 1;

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  emitClosed(): void {
    this.emit("close");
    this.destroyed = true;
    for (const listener of this.closedListeners) {
      listener();
    }
  }

  emitReadyToShow(): void {
    this.readyToShowListener?.();
  }

  focus(): void {
    this.focusCalls += 1;
  }

  getNormalBounds(): WindowBounds {
    return this.normalBounds ?? this.bounds;
  }

  getBounds(): WindowBounds {
    return this.bounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFullScreen(): boolean {
    return this.fullScreen;
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
    this.webContents.setZoomFactor(1);
    for (const listener of this.webContents.domReadyListeners) listener();
  }

  maximize(): void {
    this.maximized = true;
  }

  on(
    eventName:
      | "close"
      | "closed"
      | "enter-full-screen"
      | "leave-full-screen"
      | "move"
      | "resize"
      | "maximize"
      | "unmaximize",
    listener: () => void,
  ): void {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
    if (eventName === "closed") {
      this.closedListeners.push(listener);
    }
  }

  once(eventName: "ready-to-show", listener: () => void): void {
    if (eventName === "ready-to-show") {
      this.readyToShowListener = listener;
    }
  }

  restore(): void {
    this.minimized = false;
  }

  setBackgroundColor(color: string): void {
    this.backgroundColor = color;
  }

  setWindowButtonPosition(position: { x: number; y: number }): void {
    this.windowButtonPositions.push(position);
  }

  setFullScreen(isFullScreen: boolean): void {
    this.fullScreen = isFullScreen;
  }

  show(): void {
    this.shown = true;
  }
}

interface FactoryHarness {
  createdWindows: FakeDesktopWindow[];
  factory: ReturnType<typeof createDesktopWindowFactory>;
  userDataPath: string;
}

async function createFactoryHarness(
  overrides: Partial<Parameters<typeof createDesktopWindowFactory>[0]> = {},
): Promise<FactoryHarness> {
  const tempDir = await createTempDir();
  const createdWindows: FakeDesktopWindow[] = [];
  const browserWindowCreator: DesktopBrowserWindowCreator = {
    create(options) {
      const browserWindow = new FakeDesktopWindow({ options });
      createdWindows.push(browserWindow);
      return browserWindow;
    },
  };
  const factory = createDesktopWindowFactory({
    browserWindowCreator,
    createWindowStateKey() {
      return "window-fallback";
    },
    displayWorkAreas: [{ height: 900, width: 1440, x: 0, y: 0 }],
    headless: false,
    icon: undefined,
    isMac: true,
    isLinuxTransparent: false,
    isLinuxFrameless: false,
    shouldUseDarkColors() {
      return true;
    },
    isQuitting() {
      return false;
    },
    openExternalUrl() {},
    onWindowCreated() {},
    preloadPath: "/tmp/preload.cjs",
    userDataPath: tempDir.path,
    ...overrides,
  });
  return {
    createdWindows,
    factory,
    userDataPath: overrides.userDataPath ?? tempDir.path,
  };
}

describe("desktop window factory", () => {
  it.each([true, false])(
    "shows the window on ready-to-show only when not headless (headless: %s)",
    async (headless) => {
      const { createdWindows, factory } = await createFactoryHarness({
        headless,
      });
      await factory.createWindow({ initialUrl: null, stateKey: null });
      const window = createdWindows[0]!;
      window.emitReadyToShow();
      expect(window.shown).toBe(!headless);
    },
  );

  it.each([true, false])(
    "restores and focuses the first window only when not headless (headless: %s)",
    async (headless) => {
      const { createdWindows, factory } = await createFactoryHarness({
        headless,
      });
      await factory.createWindow({ initialUrl: null, stateKey: null });
      const window = createdWindows[0]!;
      window.minimized = true;
      expect(factory.focusFirstWindow()).toBe(true);
      expect(window.focusCalls).toBe(headless ? 0 : 1);
      expect(window.minimized).toBe(headless);
    },
  );

  it.each([true, false])(
    "disables background throttling for hidden renderers only when headless (headless: %s)",
    async (headless) => {
      const { createdWindows, factory } = await createFactoryHarness({
        headless,
      });
      await factory.createWindow({ initialUrl: null, stateKey: null });
      expect(
        createdWindows[0]?.options.webPreferences?.backgroundThrottling,
      ).toBe(headless ? false : undefined);
    },
  );

  it("skips restored maximize and full-screen state without rewriting window state when headless", async () => {
    const seeded = await createFactoryHarness();
    await seeded.factory.createWindow({ initialUrl: null, stateKey: null });
    const seededWindow = seeded.createdWindows[0]!;
    seededWindow.normalBounds = { x: 130, y: 90, width: 1000, height: 700 };
    seededWindow.bounds = { x: 0, y: 0, width: 1440, height: 900 };
    seededWindow.maximized = true;
    seededWindow.fullScreen = true;
    await seeded.factory.persistOpenWindows();
    seededWindow.emitClosed();
    await seeded.factory.persistOpenWindows();

    const { createdWindows, factory, userDataPath } =
      await createFactoryHarness({
        headless: true,
        userDataPath: seeded.userDataPath,
      });
    await factory.createWindow({ initialUrl: null, stateKey: null });
    const window = createdWindows[0]!;
    window.emitReadyToShow();
    expect(window.maximized).toBe(false);
    expect(window.fullScreen).toBe(false);
    expect(window.shown).toBe(false);

    expect(factory.zoom(window.webContents.id, "in")).toBe(true);
    expect(window.webContents.getZoomFactor()).toBe(1.1);
    window.bounds = { x: 40, y: 30, width: 800, height: 600 };
    window.emit("move");
    window.emitClosed();
    await factory.persistOpenWindows();
    await expect(
      readPersistedWindowStateFile({ userDataPath }),
    ).resolves.toEqual({
      windows: [
        {
          bounds: { x: 130, y: 90, width: 1000, height: 700 },
          isFullScreen: true,
          isMaximized: true,
          stateKey: "main",
        },
      ],
      zoomFactor: 1,
    });
  });
});

describe("desktop window factory headless argument", () => {
  it("makes every caller choose headless or windowed mode", () => {
    type FactoryArgs = Parameters<typeof createDesktopWindowFactory>[0];
    expectTypeOf<FactoryArgs["headless"]>().toEqualTypeOf<boolean>();
    expect(true).toBe(true);
  });
});
