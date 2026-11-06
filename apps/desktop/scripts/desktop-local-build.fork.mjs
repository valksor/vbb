import { resolveDesktopReleaseChannel } from "./desktop-release-channel.mjs";

const DESKTOP_LOCAL_BUILD_ENV_NAME = "BB_DESKTOP_LOCAL_BUILD";

export function resolveDesktopLocalBuild(env) {
  const rawValue = env[DESKTOP_LOCAL_BUILD_ENV_NAME]?.trim();
  if (rawValue === undefined || rawValue.length === 0) {
    return false;
  }
  if (rawValue === "0" || rawValue === "1") {
    return rawValue === "1";
  }

  throw new Error(
    `${DESKTOP_LOCAL_BUILD_ENV_NAME} must be 0 or 1, got ${rawValue}.`,
  );
}

export function forkDesktopUpdateSupport(env) {
  resolveDesktopReleaseChannel(env);
  return resolveDesktopLocalBuild(env)
    ? { autoUpdate: false, versionCheck: false }
    : null;
}

export function createLocalDesktopReleaseConfig() {
  return {
    appId: "dev.bb.desktop.local",
    applicationName: "bb Local",
    artifactName: "bb-local-${version}-${arch}.${ext}",
    iconFileName: "icon.png",
    linuxExecutableName: "bb-local",
    macIconPath: "assets/icon.icns",
    releaseTag: "desktop-latest",
    updateMetadataFileNames: {
      linux: "latest-linux.yml",
      macos: "latest-mac.yml",
    },
  };
}

export function resolveDesktopUpdateMetadataFileName(config, platform) {
  const updateMetadataFileName = config.updateMetadataFileNames[platform];
  if (updateMetadataFileName === undefined) {
    throw new Error(
      `Desktop release config has no update metadata for ${platform}.`,
    );
  }
  return updateMetadataFileName;
}

export function localDesktopReleaseInfo() {
  const { appId, applicationName } = createLocalDesktopReleaseConfig();
  return { appId, applicationName };
}

export function applyKeychainMacTimestamp(mac, signingPlan) {
  if (signingPlan.mode === "keychain") {
    mac.timestamp = "none";
  }
}

export function localSmokeLaunchArgs(localBuild) {
  return localBuild && process.platform === "darwin"
    ? ["--use-mock-keychain"]
    : [];
}
