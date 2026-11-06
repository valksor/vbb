import { buildClaudeCodeModels } from "../model-list.js";
import { filterTokenProfileModels } from "../token-profile-rules.js";
import { probeClaudeInitialization } from "./initialization-probe.js";
import {
  type TokenProfileSettingsSource,
  buildTokenProfileFlagSettings,
} from "./session-options.token.fork.js";
import {
  removeTokenFlagSettingsFile,
  requireProfileToken,
  writeTokenFlagSettingsFile,
} from "./token-flag-settings.js";

export type { TokenProfileSettingsSource };

export interface ModelProbeTarget {
  env: NodeJS.ProcessEnv;
  tokenProfile: TokenProfileSettingsSource | null;
}

export async function probeTokenProfileModels(
  env: NodeJS.ProcessEnv,
  tokenProfile: TokenProfileSettingsSource,
): Promise<ReturnType<typeof buildClaudeCodeModels>> {
  const settingsFile = writeTokenFlagSettingsFile({
    dir: tokenProfile.settingsDir,
    settings: buildTokenProfileFlagSettings(tokenProfile.env, env),
    token: requireProfileToken(env),
  });
  try {
    const initialization = await probeClaudeInitialization({
      env,
      cwd: process.cwd(),
      settingsFile,
    });
    const discovered = filterTokenProfileModels(
      initialization.models,
      tokenProfile.env,
    );
    if (discovered.length === 0) {
      throw new Error("Claude Code reported no models.");
    }
    return buildClaudeCodeModels(discovered);
  } finally {
    removeTokenFlagSettingsFile(settingsFile);
  }
}
