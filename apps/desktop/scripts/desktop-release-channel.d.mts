export type DesktopReleaseChannel = "latest" | "nightly";
export type DesktopBuildPlatform = "macos" | "linux" | "windows";

export interface DesktopUpdateMetadataFileNames {
  linux: "latest-linux.yml" | "nightly-linux.yml";
  macos: "latest-mac.yml" | "nightly-mac.yml";
  windows: "latest.yml" | "nightly.yml";
}

export interface DesktopReleaseConfigBase {
  artifactName: string;
  iconFileName: "icon.png" | "icon-nightly.png";
  linuxExecutableName: "bb" | "bb-nightly" | "bb-local";
  macIconPath: "assets/icon.icns" | "assets/icon-nightly.icns";
  releaseTag: "desktop-latest" | "desktop-nightly";
}

export interface DesktopReleaseConfig extends DesktopReleaseConfigBase {
  appId: "dev.bb.desktop" | "dev.bb.desktop.nightly";
  applicationName: "bb" | "bb Nightly";
  updateMetadataFileNames: DesktopUpdateMetadataFileNames;
  windowsInstallName: "bb" | "bb-nightly";
}

export interface DesktopLocalReleaseConfig extends DesktopReleaseConfigBase {
  appId: "dev.bb.desktop.local";
  applicationName: "bb Local";
  iconFileName: "icon.png";
  linuxExecutableName: "bb-local";
  macIconPath: "assets/icon.icns";
  releaseTag: "desktop-latest";
  updateMetadataFileNames: Omit<DesktopUpdateMetadataFileNames, "windows"> & {
    windows?: never;
  };
  windowsInstallName?: never;
}

export type ResolvedDesktopReleaseConfig =
  | DesktopReleaseConfig
  | DesktopLocalReleaseConfig;

export function resolveDesktopReleaseChannel(
  env: NodeJS.ProcessEnv,
): DesktopReleaseChannel;

export function resolveDesktopBuildPlatform(
  nodePlatform: string,
): DesktopBuildPlatform;

export function createDesktopReleaseConfig(
  channel: DesktopReleaseChannel,
  localBuild?: boolean,
): ResolvedDesktopReleaseConfig;

export function createDesktopUpdateReleaseBaseUrl(
  releaseTag: ResolvedDesktopReleaseConfig["releaseTag"],
): string;
