import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyProfileEnv,
  applyProfileSessionEnv,
  applyTokenProfileSessionEnv,
  type ActiveProfile,
  type ActiveTokenProfile,
} from "./profile-env.js";
import { readProfileToken } from "./profile-token.js";
import type { ModelProbeTarget } from "./model-list.token.fork.js";
import type { SdkSessionOptions } from "./sdk-session.js";
import {
  buildTokenProfileFlagSettings,
  type TokenProfileSettingsSource,
} from "./session-options.token.fork.js";
import { removeOnExit } from "./token-flag-settings.js";

let activeProfile: ActiveProfile | null = null;
let fallbackTokenSettingsDir: string | null = null;

function activeTokenProfile(): ActiveTokenProfile | null {
  return activeProfile?.kind === "token" ? activeProfile : null;
}

function tokenSettingsDir(bridgeTempDir: string | null): string {
  if (bridgeTempDir !== null) return bridgeTempDir;
  if (fallbackTokenSettingsDir === null) {
    const dir = mkdtempSync(join(tmpdir(), "bb-claude-token-settings-"));
    fallbackTokenSettingsDir = dir;
    removeOnExit(dir);
  }
  return fallbackTokenSettingsDir;
}

export function noteProfileRequest(params: unknown): void {
  activeProfile = applyProfileEnv(process.env, activeProfile, params);
}

export function currentProfile(): ActiveProfile | null {
  return activeProfile;
}

export function tokenProfileSettingsSource(
  bridgeTempDir: string | null,
): TokenProfileSettingsSource | null {
  const tokenProfile = activeTokenProfile();
  return tokenProfile === null
    ? null
    : { env: tokenProfile.env, settingsDir: tokenSettingsDir(bridgeTempDir) };
}

export function applyActiveProfileSessionEnv(
  sessionEnv: NodeJS.ProcessEnv,
): void {
  const tokenProfile = activeTokenProfile();
  if (tokenProfile !== null) {
    applyTokenProfileSessionEnv(
      sessionEnv,
      tokenProfile,
      readProfileToken(tokenProfile.authTokenFile),
    );
  } else {
    applyProfileSessionEnv(sessionEnv, activeProfile);
  }
}

export function refreshTokenProfileEnv(attachment: {
  sessionOptions: SdkSessionOptions;
}): void {
  const tokenProfile = activeTokenProfile();
  if (tokenProfile === null) return;
  const env = {
    ...attachment.sessionOptions.env,
    ANTHROPIC_AUTH_TOKEN: readProfileToken(tokenProfile.authTokenFile),
  };
  const settings =
    typeof attachment.sessionOptions.settings === "object"
      ? attachment.sessionOptions.settings
      : {};
  attachment.sessionOptions.settings = {
    ...settings,
    ...buildTokenProfileFlagSettings(tokenProfile.env, env),
  };
  attachment.sessionOptions.env = env;
}

export function buildModelProbeTarget(
  buildSessionEnv: (envOverrides: Record<string, string>) => NodeJS.ProcessEnv,
  bridgeTempDir: string | null,
): ModelProbeTarget {
  const tokenProfile = tokenProfileSettingsSource(bridgeTempDir);
  return tokenProfile === null
    ? { env: process.env, tokenProfile: null }
    : { env: buildSessionEnv({}), tokenProfile };
}

export function rejectForkWithoutProfileToken(
  id: string | number,
  sendError: (id: string | number, code: number, message: string) => void,
): boolean {
  const tokenProfile = activeTokenProfile();
  if (tokenProfile === null) return false;
  try {
    readProfileToken(tokenProfile.authTokenFile);
    return false;
  } catch (error) {
    sendError(
      id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
    return true;
  }
}
