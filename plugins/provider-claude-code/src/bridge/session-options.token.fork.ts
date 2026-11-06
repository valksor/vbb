import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import profileEnvNames from "./profile-env-names.json";
import { readUserSettingsEnv } from "./user-settings-env.js";

export interface TokenProfileSettingsSource {
  env: Readonly<Record<string, string>>;
  settingsDir: string;
}

const TOKEN_PROFILE_PINNED_TRANSPORT_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "CLAUDE_CODE_HTTP_PROXY",
  "CLAUDE_CODE_HTTPS_PROXY",
  "CLAUDE_CODE_PROXY_URL",
  "NODE_EXTRA_CA_CERTS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "SSL_CERT_FILE",
] as const;

const BACKEND_AUTH_SKIP_PATTERN = /^CLAUDE_CODE_SKIP_.+_AUTH$/u;

const TOKEN_PROFILE_BLANKED_KEYS: readonly string[] = [
  ...Object.entries(profileEnvNames.names)
    .filter(([, classification]) => classification === "stripped")
    .map(([name]) => name),
  ...Object.keys(profileEnvNames.names).filter((name) =>
    BACKEND_AUTH_SKIP_PATTERN.test(name),
  ),
].filter((name) => name !== "ANTHROPIC_AUTH_TOKEN");

export function buildTokenProfileFlagSettings(
  profileEnv: Readonly<Record<string, string>>,
  sessionEnv: NodeJS.ProcessEnv,
): Pick<Settings, "env" | "apiKeyHelper"> {
  const userEnv = readUserSettingsEnv();
  const blanked = Object.fromEntries(
    TOKEN_PROFILE_BLANKED_KEYS.map((key) => [key, ""]),
  );
  const pinnedTransport = Object.fromEntries(
    TOKEN_PROFILE_PINNED_TRANSPORT_KEYS.map((key) => [
      key,
      userEnv[key] ?? sessionEnv[key] ?? "",
    ]),
  );
  return {
    env: { ...blanked, ...pinnedTransport, ...profileEnv },
    apiKeyHelper: "",
  };
}

export function tokenProfileFlagSettings(
  tokenProfile: TokenProfileSettingsSource | null,
  sessionEnv: NodeJS.ProcessEnv,
): Pick<Settings, "env" | "apiKeyHelper"> {
  return tokenProfile === null
    ? {}
    : buildTokenProfileFlagSettings(tokenProfile.env, sessionEnv);
}

export function tokenFlagSettingsDirOption(
  tokenProfile: TokenProfileSettingsSource | null,
): { tokenFlagSettingsDir?: string } {
  return tokenProfile === null
    ? {}
    : { tokenFlagSettingsDir: tokenProfile.settingsDir };
}
