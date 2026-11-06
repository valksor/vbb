import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { createLocalDesktopReleaseConfig } from "../scripts/desktop-local-build.fork.mjs";
import {
  createDesktopReleaseInfo,
  resolveDesktopUpdateSupport,
} from "../src/desktop-update-provider.js";

const APP_IMAGE_PATH = "/home/user/Apps/bb-0.37.0-x86_64.AppImage";
const alwaysReplaceable = () => true;

it.each([
  {
    localBuild: "1",
    releaseChannel: "latest",
    runtimeEnv: {},
    expected: {
      appId: "dev.bb.desktop.local",
      applicationName: "bb Local",
      channel: "latest",
      releaseTag: "desktop-latest",
      updateSupport: { autoUpdate: false, versionCheck: false },
    },
  },
  {
    localBuild: "1",
    releaseChannel: "nightly",
    runtimeEnv: {},
    expected: {
      appId: "dev.bb.desktop.local",
      applicationName: "bb Local",
      channel: "nightly",
      releaseTag: "desktop-nightly",
      updateSupport: { autoUpdate: false, versionCheck: false },
    },
  },
  {
    localBuild: "0",
    releaseChannel: "latest",
    runtimeEnv: {},
    expected: {
      appId: "dev.bb.desktop",
      applicationName: "bb",
      channel: "latest",
      releaseTag: "desktop-latest",
      updateSupport: { autoUpdate: true, versionCheck: true },
    },
  },
  {
    localBuild: "0",
    releaseChannel: "nightly",
    runtimeEnv: {},
    expected: {
      appId: "dev.bb.desktop.nightly",
      applicationName: "bb Nightly",
      channel: "nightly",
      releaseTag: "desktop-nightly",
      updateSupport: { autoUpdate: true, versionCheck: true },
    },
  },
  {
    localBuild: "1",
    releaseChannel: "latest",
    runtimeEnv: {
      BB_DESKTOP_LOCAL_BUILD: "0",
      BB_DESKTOP_RELEASE_CHANNEL: "nightly",
    },
    expected: {
      appId: "dev.bb.desktop.local",
      applicationName: "bb Local",
      channel: "latest",
      releaseTag: "desktop-latest",
      updateSupport: { autoUpdate: false, versionCheck: false },
    },
  },
])(
  "bakes $releaseChannel local=$localBuild identity, feed, and update support",
  async ({ localBuild, releaseChannel, runtimeEnv, expected }) => {
    const result = await build({
      bundle: true,
      define: {
        "process.env.BB_DESKTOP_LOCAL_BUILD": JSON.stringify(localBuild),
        "process.env.BB_DESKTOP_RELEASE_CHANNEL":
          JSON.stringify(releaseChannel),
      },
      entryPoints: [resolve("src/desktop-update-provider.ts")],
      format: "cjs",
      platform: "node",
      target: "node24",
      write: false,
    });
    const module = {
      exports: {} as typeof import("../src/desktop-update-provider.js"),
    };

    runInNewContext(result.outputFiles[0]!.text, {
      module,
      process: { env: runtimeEnv },
    });

    const releaseUrl = `https://github.com/get-bb/bb/releases/download/${expected.releaseTag}/`;
    expect(module.exports.DESKTOP_RELEASE_INFO).toEqual({
      appId: expected.appId,
      applicationName: expected.applicationName,
      channel: expected.channel,
      iconFileName:
        expected.channel === "nightly" ? "icon-nightly.png" : "icon.png",
      releaseTag: expected.releaseTag,
      updateReleaseBaseUrl: releaseUrl,
    });
    expect(module.exports.DESKTOP_RELEASE_CHANNEL).toBe(expected.channel);
    expect(module.exports.DESKTOP_AUTO_UPDATE_FEED_CONFIG).toEqual({
      channel: expected.channel,
      provider: "generic",
      url: releaseUrl,
    });
    expect(module.exports.createDesktopUpdateFeedUrl("macos")).toBe(
      `${releaseUrl}desktop-version.json`,
    );
    expect(
      module.exports.resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: runtimeEnv,
        platform: "macos",
      }),
    ).toEqual(expected.updateSupport);
  },
);

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
