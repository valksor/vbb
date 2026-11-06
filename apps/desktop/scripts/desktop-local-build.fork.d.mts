import type { DesktopLocalReleaseConfig } from "./desktop-release-channel.mjs";
import type {
  DesktopBuildPlatform,
  ResolvedDesktopReleaseConfig,
} from "./desktop-release-channel.mjs";

export function resolveDesktopLocalBuild(env: NodeJS.ProcessEnv): boolean;

export function forkDesktopUpdateSupport(env: NodeJS.ProcessEnv): {
  autoUpdate: false;
  versionCheck: false;
} | null;

export function createLocalDesktopReleaseConfig(): DesktopLocalReleaseConfig;

export function resolveDesktopUpdateMetadataFileName(
  config: ResolvedDesktopReleaseConfig,
  platform: DesktopBuildPlatform,
): string;

export function localDesktopReleaseInfo(): {
  appId: "dev.bb.desktop.local";
  applicationName: "bb Local";
};

export function applyKeychainMacTimestamp(
  mac: { timestamp?: string },
  signingPlan: { mode: string },
): void;

export function localSmokeLaunchArgs(localBuild: boolean): string[];
