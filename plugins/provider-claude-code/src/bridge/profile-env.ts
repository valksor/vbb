import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseClaudeConfigDir, parseProfilePath } from "../config-dir.js";
import {
  AUTH_TOKEN_FILE_LABEL,
  tokenProfileBridgeOptionsSchema,
} from "../token-profile-rules.js";

const STRIPPED_EXACT_KEYS: ReadonlySet<string> = new Set([
  "CLAUDE_CODE_SESSION_ACCESS_TOKEN",
  "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  "CLAUDE_CODE_CUSTOM_OAUTH_URL",
  "CLAUDE_CODE_ACCOUNT_UUID",
  "CLAUDE_CODE_ORGANIZATION_UUID",
  "CLAUDE_CODE_USER_EMAIL",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
  "CLAUDE_CODE_ACCOUNT_TAGGED_ID",
  "CLAUDE_CODE_BRIDGE_OWNER_ACCOUNT_UUID",
  "CLAUDE_BG_RV_AUTH",
  "CLAUDE_BG_PTY_AUTH",
  "CLAUDE_BG_CLAIM_AUTH",
  "CLAUDE_BG_SOCKET_TOKENS_PATH",
  "AGENT_PROXY_AUTH_TOKEN",
  "CCR_AGENT_PROXY_TOKEN_FILE_DESCRIPTOR",
  "AWS_BEARER_TOKEN_BEDROCK",
  "CCR_OAUTH_TOKEN_FILE",
  "CCR_SESSION_ACCOUNT_EMAIL",
  "CLAUDE_RUNNER_ACCOUNT_EMAIL",
  "CLAUDE_RUNNER_ACCOUNT_ID",
  "CLAUDE_SESSION_INGRESS_TOKEN_FILE",
  "CLAUDE_AI_AUTHORIZE_URL",
  "CLAUDE_RUNNER_API_BASE_URL",
]);

const KEPT_CLAUDE_EXACT_KEYS: ReadonlySet<string> = new Set([
  "CLAUDE_CHROME_TAB_GROUP_KEY",
]);

const STRIPPED_CLAUDE_SUFFIXES = [
  "_TOKEN",
  "_TOKEN_FILE_DESCRIPTOR",
  "_KEY",
  "_PASSPHRASE",
  "_SECRET",
  "_SNAPSHOT_PATH",
] as const;

const STRIPPED_CLAUDE_PREFIXES = [
  "CLAUDE_CODE_OAUTH_",
  "CLAUDE_CODE_API_",
  "CLAUDE_CODE_HOST_",
  "CLAUDE_BG_AUTH_",
  "CLAUDE_BRIDGE_",
  "CLAUDE_LOCAL_OAUTH_",
] as const;

const KEPT_ANTHROPIC_EXACT_KEYS: ReadonlySet<string> = new Set([
  "ANTHROPIC_MODEL",
  "ANTHROPIC_BETAS",
  "ANTHROPIC_LOG",
]);

const KEPT_ANTHROPIC_PREFIXES = [
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_",
  "ANTHROPIC_CUSTOM_MODEL_OPTION",
] as const;

const KEPT_USE_KEYS: ReadonlySet<string> = new Set([
  "CLAUDE_CODE_USE_NATIVE_FILE_SEARCH",
  "CLAUDE_CODE_USE_POWERSHELL_TOOL",
  "CLAUDE_CODE_USE_COWORK_PLUGINS",
  "CLAUDE_CODE_USE_CCR_V2",
]);

export function isProfileStrippedEnvKey(name: string): boolean {
  if (STRIPPED_EXACT_KEYS.has(name)) return true;
  if (name.startsWith("ANTHROPIC_")) {
    return (
      !KEPT_ANTHROPIC_EXACT_KEYS.has(name) &&
      !KEPT_ANTHROPIC_PREFIXES.some((prefix) => name.startsWith(prefix))
    );
  }
  if (name.startsWith("CLAUDE_CODE_USE_")) return !KEPT_USE_KEYS.has(name);
  if (STRIPPED_CLAUDE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return true;
  }
  if (name.startsWith("CLAUDE_CODE_") && name.endsWith("_FILE_DESCRIPTOR")) {
    return true;
  }
  return (
    name.startsWith("CLAUDE_") &&
    !KEPT_CLAUDE_EXACT_KEYS.has(name) &&
    STRIPPED_CLAUDE_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}

export type ActiveProfile =
  | { kind: "login"; configDir: string }
  | {
      kind: "token";
      authTokenFile: string;
      env: Readonly<Record<string, string>>;
    };

export type ActiveTokenProfile = Extract<ActiveProfile, { kind: "token" }>;

export function applyProfileSessionEnv(
  env: NodeJS.ProcessEnv,
  profile: ActiveProfile | null,
): void {
  if (profile === null) return;
  const isToken = profile.kind === "token";
  for (const key of Object.keys(env)) {
    if (
      isProfileStrippedEnvKey(key) ||
      (isToken && key.startsWith("ANTHROPIC_"))
    ) {
      delete env[key];
    }
  }
  if (isToken) {
    delete env.CLAUDE_CONFIG_DIR;
  } else {
    env.CLAUDE_CONFIG_DIR = profile.configDir;
  }
}

export function applyTokenProfileSessionEnv(
  env: NodeJS.ProcessEnv,
  profile: ActiveTokenProfile,
  token: string,
): void {
  applyProfileSessionEnv(env, profile);
  Object.assign(env, profile.env);
  env.ANTHROPIC_AUTH_TOKEN = token;
}

const providerOptionsRecordSchema = z.record(z.string(), z.unknown());

const requestParamsSchema = z
  .object({
    providerOptions: providerOptionsRecordSchema.optional(),
    options: z
      .object({ providerOptions: providerOptionsRecordSchema.optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const profileOptionSchema = z.object({
  claudeConfigDir: z.string().optional(),
  claudeAuthTokenFile: z.unknown().optional(),
  claudeEnv: z.unknown().optional(),
});

function requestedProfile(params: unknown): ActiveProfile | undefined {
  const parsed = requestParamsSchema.safeParse(params);
  if (!parsed.success) return undefined;
  const providerOptions =
    parsed.data.providerOptions ?? parsed.data.options?.providerOptions;
  if (providerOptions === undefined) return undefined;
  const option = profileOptionSchema.parse(providerOptions);
  const hasToken =
    option.claudeAuthTokenFile !== undefined || option.claudeEnv !== undefined;
  if (option.claudeConfigDir !== undefined) {
    if (hasToken) {
      throw new Error(
        "claudeConfigDir cannot be combined with claudeAuthTokenFile or claudeEnv",
      );
    }
    return {
      kind: "login",
      configDir: parseClaudeConfigDir(option.claudeConfigDir),
    };
  }
  if (!hasToken) return undefined;
  const tokenOptions = tokenProfileBridgeOptionsSchema.parse({
    claudeAuthTokenFile: option.claudeAuthTokenFile,
    claudeEnv: option.claudeEnv,
  });
  return {
    kind: "token",
    authTokenFile: parseProfilePath(
      tokenOptions.claudeAuthTokenFile,
      AUTH_TOKEN_FILE_LABEL,
    ),
    env: tokenOptions.claudeEnv,
  };
}

function describeProfile(profile: ActiveProfile): string {
  return profile.kind === "login"
    ? profile.configDir
    : `the token profile for ${profile.authTokenFile}`;
}

export function applyProfileEnv(
  env: NodeJS.ProcessEnv,
  active: ActiveProfile | null,
  params: unknown,
): ActiveProfile | null {
  const requested = requestedProfile(params);
  if (requested === undefined) return active;
  if (active === null) {
    applyProfileSessionEnv(env, requested);
    return requested;
  }
  if (!isDeepStrictEqual(requested, active)) {
    if (
      requested.kind === "token" &&
      active.kind === "token" &&
      requested.authTokenFile === active.authTokenFile
    ) {
      throw new Error(
        `This Claude Code bridge is bound to ${describeProfile(active)} with different env settings and cannot switch to the changed profile; a changed profile runs in a new bridge process, so start a new thread on it`,
      );
    }
    throw new Error(
      `This Claude Code bridge is bound to ${describeProfile(active)} and cannot switch to ${describeProfile(requested)}`,
    );
  }
  return active;
}
