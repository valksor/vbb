import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showDesktopDialogHtml } from "../src/desktop-dialog-window.js";

vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  screen: { getDisplayMatching: () => ({ workAreaSize: { height: 0 } }) },
}));

class FakeDialogWindow {
  public destroyed = false;
  public readonly loadedUrls: string[] = [];
  public readonly contentSizes: Array<[number, number]> = [];
  public readonly resizableValues: boolean[] = [];
  public showCount = 0;
  public readonly webContents: {
    once(eventName: string, listener: () => void): void;
    executeJavaScript(): Promise<number>;
  };

  private readonly listeners: Map<string, () => void>;

  constructor() {
    const listeners = new Map<string, () => void>();
    this.webContents = {
      once: (eventName: string, listener: () => void) => {
        listeners.set(eventName, listener);
      },
      executeJavaScript: () => Promise.resolve(273),
    };
    this.listeners = listeners;
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 440, height: 320 };
  }

  getContentSize(): [number, number] {
    return [440, 320];
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isResizable(): boolean {
    return false;
  }

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
    this.listeners.get("did-finish-load")?.();
  }

  setResizable(resizable: boolean): void {
    this.resizableValues.push(resizable);
  }

  setContentSize(width: number, height: number): void {
    this.contentSizes.push([width, height]);
  }

  show(): void {
    this.showCount += 1;
  }
}

async function flushDialogLifecycle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("showDesktopDialogHtml", () => {
  it("measures the content, fits the dialog and shows it once", async () => {
    const dialogWindow = new FakeDialogWindow();
    showDesktopDialogHtml(
      dialogWindow as unknown as BrowserWindow,
      "<p>hi</p>",
    );
    await flushDialogLifecycle();
    expect(dialogWindow.loadedUrls).toHaveLength(1);
    expect(dialogWindow.contentSizes).toEqual([[440, 120]]);
    expect(dialogWindow.resizableValues).toEqual([true, false]);
    expect(dialogWindow.showCount).toBe(1);
  });

  it("keeps the dialog hidden while headless", async () => {
    vi.stubEnv("BB_DESKTOP_HEADLESS", "1");
    const dialogWindow = new FakeDialogWindow();
    showDesktopDialogHtml(
      dialogWindow as unknown as BrowserWindow,
      "<p>hidden</p>",
    );
    await flushDialogLifecycle();
    expect(dialogWindow.showCount).toBe(0);
  });
});
