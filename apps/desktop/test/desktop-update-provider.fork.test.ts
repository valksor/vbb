import { describe, expect, it } from "vitest";
import { createLocalDesktopReleaseConfig } from "../scripts/desktop-local-build.fork.mjs";
import {
  createDesktopReleaseInfo,
  resolveDesktopUpdateSupport,
} from "../src/desktop-update-provider.js";

const APP_IMAGE_PATH = "/home/user/Apps/bb-0.37.0-x86_64.AppImage";
const alwaysReplaceable = () => true;

describe("desktop update support", () => {
  it("disables official update paths for local builds", () => {
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: {
          APPIMAGE: APP_IMAGE_PATH,
          BB_DESKTOP_LOCAL_BUILD: "1",
        },
        platform: "macos",
      }),
    ).toEqual({ autoUpdate: false, versionCheck: false });
  });

  it("rejects an invalid release channel in the environment", () => {
    expect(() =>
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: {
          BB_DESKTOP_RELEASE_CHANNEL: "canary",
        },
        platform: "macos",
      }),
    ).toThrow(
      "BB_DESKTOP_RELEASE_CHANNEL must be latest or nightly, got canary.",
    );
  });
});

describe("desktop release info", () => {
  it.each(["latest", "nightly"] as const)(
    "packages local builds with the local identity on the %s channel",
    (channel) => {
      const info = createDesktopReleaseInfo(channel, true);

      expect(info.appId).toBe(createLocalDesktopReleaseConfig().appId);
      expect(info.applicationName).toBe("bb Local");
    },
  );

  it("keeps the official identities for non-local builds", () => {
    expect(createDesktopReleaseInfo("latest", false)).toMatchObject({
      appId: "dev.bb.desktop",
      applicationName: "bb",
    });
    expect(createDesktopReleaseInfo("nightly", false)).toMatchObject({
      appId: "dev.bb.desktop.nightly",
      applicationName: "bb Nightly",
    });
  });

  it("keeps the nightly icon and release tag for local nightly builds", () => {
    expect(createDesktopReleaseInfo("nightly", true)).toMatchObject({
      iconFileName: "icon-nightly.png",
      releaseTag: "desktop-nightly",
    });
  });
});

it.each([
  [undefined, "macos", { autoUpdate: true, versionCheck: true }],
  [undefined, "windows", { autoUpdate: true, versionCheck: true }],
  [undefined, "linux", { autoUpdate: true, versionCheck: true }],
  ["0", "macos", { autoUpdate: true, versionCheck: true }],
  ["0", "windows", { autoUpdate: true, versionCheck: true }],
  ["0", "linux", { autoUpdate: true, versionCheck: true }],
] as const)(
  "keeps public update support when BB_DESKTOP_LOCAL_BUILD is %s on %s",
  (localBuild, platform, expected) => {
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: {
          APPIMAGE: APP_IMAGE_PATH,
          ...(localBuild === undefined
            ? {}
            : { BB_DESKTOP_LOCAL_BUILD: localBuild }),
        },
        platform,
      }),
    ).toEqual(expected);
  },
);
