import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type ActiveProfile,
  applyProfileEnv,
  applyProfileSessionEnv,
  isProfileStrippedEnvKey,
} from "./profile-env.js";

const fixtureSchema = z.object({
  source: z.object({ version: z.string().min(1) }),
  names: z.record(z.string(), z.enum(["stripped", "kept"])),
});

const fixture = fixtureSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./profile-env-names.json", import.meta.url)),
      "utf8",
    ),
  ),
);

const PROFILE_DIR = join(homedir(), ".claude-profile-test");
const LOGIN_PROFILE: ActiveProfile = { kind: "login", configDir: PROFILE_DIR };

function sampleEnv(): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "key",
    ANTHROPIC_MODEL: "model",
    CLAUDE_CODE_OAUTH_TOKEN: "token",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_CCR_V2: "1",
  };
}

describe("isProfileStrippedEnvKey", () => {
  it.each(Object.entries(fixture.names))(
    "classifies %s as %s",
    (name, classification) => {
      expect(isProfileStrippedEnvKey(name)).toBe(classification === "stripped");
    },
  );

  it("fails closed on unknown ANTHROPIC_ and CLAUDE_CODE_USE_ names", () => {
    expect(isProfileStrippedEnvKey("ANTHROPIC_FUTURE_ROUTING")).toBe(true);
    expect(isProfileStrippedEnvKey("CLAUDE_CODE_USE_FUTURE_BACKEND")).toBe(
      true,
    );
  });

  it("strips every CLAUDE_CODE_HOST_ name and the host-managed auth markers", () => {
    for (const name of [
      "CLAUDE_CODE_HOST_CREDS_FILE",
      "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
      "CLAUDE_CODE_HOST_GATEWAY_LINEAGE",
      "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
      "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    ]) {
      expect(isProfileStrippedEnvKey(name)).toBe(true);
    }
  });

  it("strips every CLAUDE_ credential-shaped name by suffix", () => {
    for (const name of [
      "CLAUDE_CODE_GATEWAY_TOKEN",
      "CLAUDE_CODE_MEMORY_API_TOKEN",
      "CLAUDE_CODE_ARTIFACTS_API_TOKEN",
      "CLAUDE_CODE_MESSAGING_TOKEN",
      "CLAUDE_CODE_SLACK_TAG_TOKEN",
      "CLAUDE_CODE_HFI_BEARER_TOKEN",
      "CLAUDE_CODE_MCP_SERVE_AUTH_TOKEN",
      "CLAUDE_CODE_CLIENT_KEY",
      "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
      "CLAUDE_BRIDGE_OAUTH_TOKEN",
      "CLAUDE_TRUSTED_DEVICE_TOKEN",
      "CLAUDE_BG_AUTH_SNAPSHOT_PATH",
      "CLAUDE_FUTURE_SERVICE_SECRET",
      "CLAUDE_FUTURE_TOKEN_FILE_DESCRIPTOR",
    ]) {
      expect(isProfileStrippedEnvKey(name)).toBe(true);
    }
  });

  it("strips the CLAUDE_BG_AUTH_ family and the exact account and proxy credentials", () => {
    for (const name of [
      "CLAUDE_BG_AUTH_FUTURE",
      "CLAUDE_BG_RV_AUTH",
      "CLAUDE_BG_PTY_AUTH",
      "CLAUDE_BG_CLAIM_AUTH",
      "CLAUDE_BG_SOCKET_TOKENS_PATH",
      "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
      "CLAUDE_CODE_ACCOUNT_TAGGED_ID",
      "CLAUDE_CODE_BRIDGE_OWNER_ACCOUNT_UUID",
      "AGENT_PROXY_AUTH_TOKEN",
      "CCR_AGENT_PROXY_TOKEN_FILE_DESCRIPTOR",
      "AWS_BEARER_TOKEN_BEDROCK",
    ]) {
      expect(isProfileStrippedEnvKey(name)).toBe(true);
    }
  });

  it("keeps proxies and ordinary model and feature variables", () => {
    for (const name of [
      "CLAUDE_CODE_PROXY_URL",
      "CLAUDE_CODE_HTTP_PROXY",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "AGENT_PROXY_URL",
      "CCR_AGENT_PROXY_ENABLED",
      "CLAUDE_CHROME_TAB_GROUP_KEY",
      "ANTHROPIC_MODEL",
      "CLAUDE_CODE_SUBAGENT_MODEL",
      "CLAUDE_CODE_DISABLE_1M_CONTEXT",
      "CLAUDE_CODE_USE_NATIVE_FILE_SEARCH",
    ]) {
      expect(isProfileStrippedEnvKey(name)).toBe(false);
    }
  });

  it("leaves unrelated variables alone", () => {
    for (const name of [
      "PATH",
      "HOME",
      "CLAUDE_CODE_ENTRYPOINT",
      "CLAUDE_CODE_DISABLE_1M_CONTEXT",
      "CLAUDE_AGENT_SDK_CLIENT_APP",
      "CLAUDE_CONFIG_DIR",
    ]) {
      expect(isProfileStrippedEnvKey(name)).toBe(false);
    }
  });
});

describe("applyProfileEnv", () => {
  it("leaves env untouched when the option is absent", () => {
    const env = sampleEnv();
    const before = { ...env };
    expect(
      applyProfileEnv(env, null, { options: { providerOptions: {} } }),
    ).toBe(null);
    expect(applyProfileEnv(env, null, {})).toBe(null);
    expect(applyProfileEnv(env, null, undefined)).toBe(null);
    expect(env).toEqual(before);
  });

  it("adopts the dir from params.providerOptions", () => {
    const env = sampleEnv();
    const dir = applyProfileEnv(env, null, {
      providerOptions: { claudeConfigDir: PROFILE_DIR },
    });
    expect(dir).toEqual(LOGIN_PROFILE);
    expect(env).toEqual({
      PATH: "/usr/bin",
      ANTHROPIC_MODEL: "model",
      CLAUDE_CODE_USE_CCR_V2: "1",
      CLAUDE_CONFIG_DIR: PROFILE_DIR,
    });
  });

  it("adopts the dir from params.options.providerOptions and expands ~", () => {
    const env = sampleEnv();
    const dir = applyProfileEnv(env, null, {
      options: {
        providerOptions: { claudeConfigDir: "~/.claude-profile-test" },
      },
    });
    expect(dir).toEqual(LOGIN_PROFILE);
    expect(env.CLAUDE_CONFIG_DIR).toBe(PROFILE_DIR);
  });

  it("treats the same value again as a no-op", () => {
    const env = sampleEnv();
    const params = { providerOptions: { claudeConfigDir: PROFILE_DIR } };
    const first = applyProfileEnv(env, null, params);
    env.ANTHROPIC_API_KEY = "reintroduced";
    expect(applyProfileEnv(env, first, params)).toEqual(LOGIN_PROFILE);
    expect(env.ANTHROPIC_API_KEY).toBe("reintroduced");
  });

  it("fails a different normalized dir and leaves env on the first", () => {
    const env = sampleEnv();
    const first = applyProfileEnv(env, null, {
      providerOptions: { claudeConfigDir: PROFILE_DIR },
    });
    expect(() =>
      applyProfileEnv(env, first, {
        providerOptions: { claudeConfigDir: "/srv/other" },
      }),
    ).toThrow(/cannot switch/u);
    expect(env.CLAUDE_CONFIG_DIR).toBe(PROFILE_DIR);
  });

  it.each([
    "relative",
    "~",
    homedir(),
    `${PROFILE_DIR}/`,
    "/srv/../etc",
    "/srv/a$b",
  ])("rejects invalid dir %j without touching env", (value) => {
    const env = sampleEnv();
    const before = { ...env };
    expect(() =>
      applyProfileEnv(env, null, {
        providerOptions: { claudeConfigDir: value },
      }),
    ).toThrow();
    expect(env).toEqual(before);
  });
});

describe("applyProfileSessionEnv", () => {
  it("strips credentials re-introduced by overrides and pins the dir", () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_OAUTH_TOKEN: "from-config-envVars",
      ANTHROPIC_AUTH_TOKEN: "from-config-envVars",
      CLAUDE_CONFIG_DIR: "/somewhere/else",
      KEEP: "1",
    };
    applyProfileSessionEnv(env, LOGIN_PROFILE);
    expect(env).toEqual({ KEEP: "1", CLAUDE_CONFIG_DIR: PROFILE_DIR });
  });

  it("does nothing without a profile", () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_CODE_OAUTH_TOKEN: "t" };
    applyProfileSessionEnv(env, null);
    expect(env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "t" });
  });
});
