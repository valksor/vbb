import { app, type App } from "electron";
import type { DesktopAutoUpdateLogger } from "./desktop-auto-update.js";
import { isDesktopHeadless } from "./desktop-headless.js";

export function isDesktopHeadlessProcess(): boolean {
  return isDesktopHeadless({ env: process.env, isPackaged: app.isPackaged });
}

export function applyDesktopHeadlessStartup(
  startupApp: Pick<App, "dock">,
  logger: Pick<DesktopAutoUpdateLogger, "info">,
): void {
  if (!isDesktopHeadlessProcess()) return;
  if (process.platform === "darwin" && startupApp.dock !== undefined) {
    startupApp.dock.hide();
  }
  logger.info("headless: windows will not be shown");
}
