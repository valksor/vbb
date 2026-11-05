import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  containsControlBidiOrInvisibleCharacter,
  validateProfilePathForm,
} from "./config-dir.js";

const TOKEN_PROFILE_ENV_PATTERNS: readonly RegExp[] = [
  /^ANTHROPIC_BASE_URL$/u,
  /^ANTHROPIC_(?:SMALL_FAST_)?MODEL$/u,
  /^ANTHROPIC_DEFAULT_(?:OPUS|SONNET|HAIKU|FABLE)_MODEL(?:_NAME|_DESCRIPTION|_SUPPORTED_CAPABILITIES)?$/u,
  /^ANTHROPIC_CUSTOM_MODEL_OPTION(?:_NAME|_DESCRIPTION|_SUPPORTED_CAPABILITIES)?$/u,
  /^API_TIMEOUT_MS$/u,
  /^CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC$/u,
  /^CLAUDE_CODE_AUTO_COMPACT_WINDOW$/u,
];

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

const MODEL_ENV_KEY_PATTERN =
  /^ANTHROPIC_(?:MODEL|SMALL_FAST_MODEL|DEFAULT_(?:OPUS|SONNET|HAIKU|FABLE)_MODEL|CUSTOM_MODEL_OPTION)$/u;

export const AUTH_TOKEN_FILE_LABEL = "authTokenFile";
export const BASE_URL_ENV_KEY = "ANTHROPIC_BASE_URL";

export function isAllowedTokenProfileEnvKey(name: string): boolean {
  return TOKEN_PROFILE_ENV_PATTERNS.some((pattern) => pattern.test(name));
}

export function isTokenProfileModelEnvKey(name: string): boolean {
  return MODEL_ENV_KEY_PATTERN.test(name);
}

export function tokenProfileModelValues(
  env: Readonly<Record<string, string>>,
): Set<string> {
  return new Set(
    Object.entries(env)
      .filter(([name]) => isTokenProfileModelEnvKey(name))
      .map(([, value]) => value),
  );
}

export function baseUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${BASE_URL_ENV_KEY} must be an absolute URL`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `${BASE_URL_ENV_KEY} must use https`;
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    return `${BASE_URL_ENV_KEY} may use http only for localhost, 127.0.0.1 or [::1]`;
  }
  if (url.username !== "" || url.password !== "") {
    return `${BASE_URL_ENV_KEY} must not contain userinfo`;
  }
  if (url.search !== "" || url.hash !== "") {
    return `${BASE_URL_ENV_KEY} must not contain a query or fragment`;
  }
  return null;
}

const ZAI_USAGE_HOSTNAMES: ReadonlySet<string> = new Set([
  "api.z.ai",
  "open.bigmodel.cn",
  "dev.bigmodel.cn",
]);

export function isZaiUsageBaseUrl(url: string | undefined): boolean {
  if (url === undefined) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && ZAI_USAGE_HOSTNAMES.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function nonessentialTrafficDisabled(
  env: Readonly<Record<string, string>>,
): boolean {
  const value =
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC?.trim().toLowerCase();
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}

export const tokenProfileAuthTokenFileSchema = z
  .string()
  .superRefine((value, context) => {
    try {
      validateProfilePathForm(value, AUTH_TOKEN_FILE_LABEL);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

export const tokenProfileEnvSchema = z
  .record(z.string(), z.string())
  .superRefine((env, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message });
    for (const [name, value] of Object.entries(env)) {
      if (!isAllowedTokenProfileEnvKey(name)) {
        issue(
          `env.${name} is not allowed in a token profile; put secrets in authTokenFile and use only the documented model, timeout and traffic variables`,
        );
        continue;
      }
      if (containsControlBidiOrInvisibleCharacter(value)) {
        issue(
          `env.${name} must not contain a control or bidi character, or an invisible one`,
        );
      }
    }
    const baseUrl = env[BASE_URL_ENV_KEY];
    if (baseUrl === undefined) {
      issue(`env.${BASE_URL_ENV_KEY} is required`);
      return;
    }
    const problem = baseUrlProblem(baseUrl);
    if (problem !== null) issue(`env.${problem}`);
    if (
      !Object.entries(env).some(
        ([name, value]) =>
          isTokenProfileModelEnvKey(name) && value.trim().length > 0,
      )
    ) {
      issue(
        "env must set a non-empty value for at least one model: ANTHROPIC_MODEL, ANTHROPIC_SMALL_FAST_MODEL, ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL or ANTHROPIC_CUSTOM_MODEL_OPTION, so the profile lists models the endpoint serves",
      );
    }
  });

export const tokenProfileBridgeOptionsSchema = z
  .object({
    claudeAuthTokenFile: tokenProfileAuthTokenFileSchema,
    claudeEnv: tokenProfileEnvSchema,
  })
  .strict();

const ALIAS_ONE_MILLION_CONTEXT_PATTERN =
  /^(?:opus|sonnet|haiku|fable)\[1m\]$/u;

export function filterTokenProfileModels(
  discoveredModels: readonly ModelInfo[],
  profileEnv: Readonly<Record<string, string>>,
): ModelInfo[] {
  const profileModels = tokenProfileModelValues(profileEnv);
  return discoveredModels.filter(
    (modelInfo) =>
      !ALIAS_ONE_MILLION_CONTEXT_PATTERN.test(modelInfo.value) &&
      profileModels.has(modelInfo.resolvedModel ?? modelInfo.value),
  );
}
