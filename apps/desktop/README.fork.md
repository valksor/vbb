# Desktop (fork)

## Testing (replaces the Electron startup smoke paragraph)

The desktop tests include an Electron startup smoke that runs the real app
with `BB_DESKTOP_HEADLESS=1` set by the test itself, so every window stays
hidden. On Linux it runs
only when `DISPLAY` is set; on a headless host, wrap the test command in
`xvfb-run -a`, as CI does.

## Before the "About panel" section

## Local build

Local builds set `BB_DESKTOP_LOCAL_BUILD=1` at build time. They install and run
alongside a stable `bb` because they keep a distinct on-disk identity:

- product name / bundle folder: `bb Local.app`
- bundle identifier: `dev.bb.desktop.local`
- runtime app ID: `dev.bb.desktop.local` (`localDesktopReleaseInfo()` in
  `scripts/desktop-local-build.fork.mjs`), used by `app.setAppUserModelId` so
  it matches the packaged app ID
- Linux binary name: `bb-local`, so it never shadows stable `bb` on PATH
- no update feed (`publish` is empty; auto-update and version checks are off)

The local build keeps the `bb Local` name in the packaged app and at runtime.
Its Electron user data is separate from the stable app; the embedded bb runtime
uses the normal `~/.bb` data (or `BB_DATA_DIR`) and getbb.app services.

## Before the paragraph "Unpackaged runs use `assets/icon-dev.png`"

`BB_DESKTOP_HEADLESS=1` keeps every app window hidden in unpackaged builds so
the Electron smoke test does not take over the screen. Native OS dialogs
(About, server-moved notices, microphone consent) are not gated and still
appear, and the Dock icon may flash briefly at startup before it hides.
Interactive flows that wait for input (server dialogs, Connect sign-in) stall
while hidden and fail closed; the sign-in window intentionally keeps its
constructor-only `show` because a hung remote load never fires
`ready-to-show`. Window layout and zoom changes made during a headless run
are not persisted. Packaged launches ignore the variable.
