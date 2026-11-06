import { spawn } from "node:child_process";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createLocalDesktopReleaseConfig,
  localSmokeLaunchArgs,
  resolveDesktopLocalBuild,
  resolveDesktopUpdateMetadataFileName,
} from "../scripts/desktop-local-build.fork.mjs";
import { createDesktopReleaseConfig } from "../scripts/desktop-release-channel.mjs";

const desktopPackageRoot = process.cwd();

const macConfigSchema = z
  .object({
    entitlements: z.string().min(1),
    entitlementsInherit: z.string().min(1),
    gatekeeperAssess: z.literal(false),
    hardenedRuntime: z.literal(true),
    icon: z.string().min(1),
    identity: z.string().nullable().optional(),
    notarize: z.boolean(),
    timestamp: z.string().optional(),
    target: z.tuple([
      z
        .object({
          arch: z.tuple([z.literal("arm64")]),
          target: z.literal("dmg"),
        })
        .passthrough(),
      z
        .object({
          arch: z.tuple([z.literal("arm64")]),
          target: z.literal("zip"),
        })
        .passthrough(),
    ]),
  })
  .passthrough();

const linuxConfigSchema = z
  .object({
    category: z.literal("Development"),
    executableName: z.enum(["bb", "bb-nightly", "bb-local"]),
    icon: z.string().min(1),
    target: z.tuple([
      z
        .object({
          arch: z.tuple([z.literal("x64")]),
          target: z.literal("AppImage"),
        })
        .passthrough(),
    ]),
  })
  .passthrough();

const electronBuilderFileSetSchema = z
  .object({
    filter: z.array(z.string().min(1)),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .passthrough();

const electronBuilderFilePatternSchema = z.union([
  z.string().min(1),
  electronBuilderFileSetSchema,
]);

const electronBuilderConfigSchema = z
  .object({
    afterPack: z.string().min(1),
    asarUnpack: z.array(z.string().min(1)),
    dmg: z.object({ sign: z.boolean() }).passthrough(),
    files: z.array(electronBuilderFilePatternSchema),
    linux: linuxConfigSchema,
    mac: macConfigSchema,
    npmRebuild: z.literal(false),
    appId: z.string().min(1),
    artifactName: z.string().min(1),
    productName: z.string().min(1),
    publish: z.union([
      z.tuple([]),
      z.tuple([
        z
          .object({
            channel: z.enum(["latest", "nightly"]),
            provider: z.literal("generic"),
            url: z.string().min(1),
          })
          .passthrough(),
      ]),
    ]),
    toolsets: z.object({ appimage: z.literal("1.0.3") }),
  })
  .passthrough();

const signingEnvironmentKeys = [
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_ID",
  "APPLE_TEAM_ID",
  "CSC_IDENTITY_AUTO_DISCOVERY",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "CSC_NAME",
];

type EnvironmentOverrides = Record<string, string | undefined>;

const createScriptEnvironment = (overrides: EnvironmentOverrides) => {
  const env = { ...process.env };

  for (const key of [
    ...signingEnvironmentKeys,
    "BB_DESKTOP_LOCAL_BUILD",
    "BB_DESKTOP_RELEASE_CHANNEL",
  ]) {
    delete env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  return env;
};

const runConfigScript = async (overrides: EnvironmentOverrides) => {
  const child = spawn(
    process.execPath,
    ["scripts/run-electron-builder.mjs", "--print-config"],
    { cwd: desktopPackageRoot, env: createScriptEnvironment(overrides) },
  );
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

  const exitCode = await new Promise<number | null>((resolveExitCode) => {
    child.on("close", resolveExitCode);
  });

  return {
    exitCode,
    stderr: stderrChunks.join(""),
    stdout: stdoutChunks.join(""),
  };
};

const readResolvedConfig = async (overrides: EnvironmentOverrides) => {
  const result = await runConfigScript(overrides);
  expect(result.exitCode).toBe(0);
  return electronBuilderConfigSchema.parse(JSON.parse(result.stdout));
};

describe("electron-builder local config", () => {
  it("creates a separate local app identity without an update feed", async () => {
    const config = await readResolvedConfig({ BB_DESKTOP_LOCAL_BUILD: "1" });

    expect(config.appId).toBe("dev.bb.desktop.local");
    expect(config.productName).toBe("bb Local");
    expect(config.artifactName).toBe("bb-local-${version}-${arch}.${ext}");
    expect(config.linux.executableName).toBe("bb-local");
    expect(config.publish).toEqual([]);
    expect(createLocalDesktopReleaseConfig()).not.toHaveProperty(
      "windowsInstallName",
    );
    expect(createLocalDesktopReleaseConfig().updateMetadataFileNames).not.toHaveProperty(
      "windows",
    );
  });

  it("rejects an invalid local build selector", async () => {
    const result = await runConfigScript({ BB_DESKTOP_LOCAL_BUILD: "yes" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("BB_DESKTOP_LOCAL_BUILD must be 0 or 1");
  });

  it("reports the invalid local build selector before the invalid release channel", async () => {
    const result = await runConfigScript({
      BB_DESKTOP_LOCAL_BUILD: "yes",
      BB_DESKTOP_RELEASE_CHANNEL: "canary",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("BB_DESKTOP_LOCAL_BUILD must be 0 or 1");
    expect(result.stderr).not.toContain("BB_DESKTOP_RELEASE_CHANNEL must be");
  });

  it.each([
    [undefined, false],
    ["", false],
    ["0", false],
    ["1", true],
    [" 1 ", true],
  ])("parses BB_DESKTOP_LOCAL_BUILD=%s", (rawValue, expected) => {
    expect(resolveDesktopLocalBuild({ BB_DESKTOP_LOCAL_BUILD: rawValue })).toBe(
      expected,
    );
  });

  it("rejects invalid local selector values", () => {
    expect(() =>
      resolveDesktopLocalBuild({ BB_DESKTOP_LOCAL_BUILD: "yes" }),
    ).toThrow("BB_DESKTOP_LOCAL_BUILD must be 0 or 1, got yes.");
  });

  it("keeps public and nightly identities outside local builds", async () => {
    await expect(readResolvedConfig({})).resolves.toMatchObject({
      appId: "dev.bb.desktop",
      productName: "bb",
    });
    await expect(
      readResolvedConfig({ BB_DESKTOP_RELEASE_CHANNEL: "nightly" }),
    ).resolves.toMatchObject({
      appId: "dev.bb.desktop.nightly",
      productName: "bb Nightly",
    });
    await expect(
      readResolvedConfig({
        BB_DESKTOP_LOCAL_BUILD: "1",
        BB_DESKTOP_RELEASE_CHANNEL: "nightly",
      }),
    ).resolves.toMatchObject({
      appId: "dev.bb.desktop.local",
      productName: "bb Local",
    });
  });

  it("adds the mock keychain argument only for local macOS smoke launches", () => {
    expect(localSmokeLaunchArgs(false)).toEqual([]);
    expect(localSmokeLaunchArgs(true)).toEqual(
      process.platform === "darwin" ? ["--use-mock-keychain"] : [],
    );
  });

  it.each([
    ["local macOS", createDesktopReleaseConfig("latest", true), "macos", "latest-mac.yml"],
    ["local Linux", createDesktopReleaseConfig("latest", true), "linux", "latest-linux.yml"],
    ["public latest Windows", createDesktopReleaseConfig("latest"), "windows", "latest.yml"],
    ["public nightly Windows", createDesktopReleaseConfig("nightly"), "windows", "nightly.yml"],
  ] as const)(
    "resolves update metadata for %s",
    (_name, config, platform, expected) => {
      expect(resolveDesktopUpdateMetadataFileName(config, platform)).toBe(
        expected,
      );
    },
  );

  it("rejects a local Windows update metadata lookup", () => {
    expect(() =>
      resolveDesktopUpdateMetadataFileName(
        createDesktopReleaseConfig("latest", true),
        "windows",
      ),
    ).toThrow("Desktop release config has no update metadata for windows.");
  });
});

describe("electron-builder signing config", () => {
  it.each(["0", "1"])(
    "uses no timestamp for keychain signing with local build flag %s",
    async (localBuild) => {
      const config = await readResolvedConfig({
        BB_DESKTOP_LOCAL_BUILD: localBuild,
      });

      expect(config.mac).not.toHaveProperty("identity");
      expect(config.mac.timestamp).toBe("none");
      expect(config.mac.notarize).toBe(false);
      expect(config.dmg.sign).toBe(false);
    },
  );

  it("keeps builds unsigned when keychain auto-discovery is explicitly disabled", async () => {
    const config = await readResolvedConfig({
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    });

    expect(config.mac.identity).toBeNull();
    expect(config.mac).not.toHaveProperty("timestamp");
    expect(config.mac.notarize).toBe(false);
  });

  it("rejects partial signing secret sets", async () => {
    const result = await runConfigScript({
      APPLE_ID: "sawyer@example.com",
      CSC_KEY_PASSWORD: "p12-password",
      CSC_LINK: "base64-p12",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Incomplete macOS signing/notarization environment.",
    );
    expect(result.stderr).toContain(
      "Present: CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID.",
    );
    expect(result.stderr).toContain(
      "Missing: APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.",
    );
  });

  it("enables app signing and notarization when signing and Apple credentials are complete", async () => {
    const config = await readResolvedConfig({
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_ID: "sawyer@example.com",
      APPLE_TEAM_ID: "TEAMID1234",
      CSC_KEY_PASSWORD: "p12-password",
      CSC_LINK: "base64-p12",
      CSC_NAME: "Sawyer Hood (TEAMID1234)",
    });

    expect(config.mac.identity).toBe("Sawyer Hood (TEAMID1234)");
    expect(config.mac).not.toHaveProperty("timestamp");
    expect(config.mac.notarize).toBe(true);
    expect(config.dmg.sign).toBe(false);
  });
});
