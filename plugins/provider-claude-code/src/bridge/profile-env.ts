import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseClaudeConfigDir } from "../config-dir.js";

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

export type ActiveProfile = { kind: "login"; configDir: string };

export function applyProfileSessionEnv(
  env: NodeJS.ProcessEnv,
  profile: ActiveProfile | null,
): void {
  if (profile === null) return;
  for (const key of Object.keys(env)) {
    if (isProfileStrippedEnvKey(key)) delete env[key];
  }
  env.CLAUDE_CONFIG_DIR = profile.configDir;
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
});

function requestedProfile(params: unknown): ActiveProfile | undefined {
  const parsed = requestParamsSchema.safeParse(params);
  if (!parsed.success) return undefined;
  const providerOptions =
    parsed.data.providerOptions ?? parsed.data.options?.providerOptions;
  if (providerOptions === undefined) return undefined;
  const option = profileOptionSchema.parse(providerOptions);
  if (option.claudeConfigDir === undefined) return undefined;
  return {
    kind: "login",
    configDir: parseClaudeConfigDir(option.claudeConfigDir),
  };
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
    throw new Error(
      `This Claude Code bridge is bound to ${active.configDir} and cannot switch to ${requested.configDir}`,
    );
  }
  return active;
}
