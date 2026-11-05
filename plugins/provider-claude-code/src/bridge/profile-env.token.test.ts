import { describe, expect, it } from "vitest";
import {
  applyProfileEnv,
  applyProfileSessionEnv,
  applyTokenProfileSessionEnv,
  type ActiveTokenProfile,
} from "./profile-env.js";

const TOKEN_FILE = "/srv/bb/glm.token";
const GLM_ENV = {
  ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
  API_TIMEOUT_MS: "3000000",
};
const TOKEN_PROFILE: ActiveTokenProfile = {
  kind: "token",
  authTokenFile: TOKEN_FILE,
  env: GLM_ENV,
};

function tokenOptions(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    providerOptions: {
      claudeAuthTokenFile: TOKEN_FILE,
      claudeEnv: GLM_ENV,
      ...overrides,
    },
  };
}

function ambientEnv(): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin",
    CLAUDE_CONFIG_DIR: "/ambient/config",
    ANTHROPIC_API_KEY: "key",
    ANTHROPIC_BASE_URL: "https://ambient.example",
    ANTHROPIC_MODEL: "ambient-model",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "ambient-sonnet",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    HTTPS_PROXY: "http://proxy.test:3128",
  };
}

describe("token profile adoption", () => {
  it("adopts the token file and env and strips only credentials from the bridge env", () => {
    const env = ambientEnv();

    const profile = applyProfileEnv(env, null, tokenOptions());

    expect(profile).toEqual(TOKEN_PROFILE);
    expect(env).toEqual({
      PATH: "/usr/bin",
      HTTPS_PROXY: "http://proxy.test:3128",
    });
  });

  it("never applies the profile env or a token to the bridge process env", () => {
    const env = ambientEnv();

    applyProfileEnv(env, null, tokenOptions());

    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it("treats the same profile with a different key order as a no-op", () => {
    const env = ambientEnv();
    const first = applyProfileEnv(env, null, tokenOptions());
    const reordered = Object.fromEntries(Object.entries(GLM_ENV).reverse());

    expect(
      applyProfileEnv(env, first, tokenOptions({ claudeEnv: reordered })),
    ).toBe(first);
  });

  it("says to reload the provider when only the env differs", () => {
    const env = ambientEnv();
    const first = applyProfileEnv(env, null, tokenOptions());

    expect(() =>
      applyProfileEnv(
        env,
        first,
        tokenOptions({ claudeEnv: { ...GLM_ENV, API_TIMEOUT_MS: "1" } }),
      ),
    ).toThrow(/different env settings.*start a new thread/u);
  });

  it("refuses to switch to a different token file, env value or kind", () => {
    const env = ambientEnv();
    const first = applyProfileEnv(env, null, tokenOptions());

    expect(() =>
      applyProfileEnv(
        env,
        first,
        tokenOptions({ claudeAuthTokenFile: "/srv/bb/other.token" }),
      ),
    ).toThrow(/cannot switch/u);
    expect(() =>
      applyProfileEnv(
        env,
        first,
        tokenOptions({
          claudeEnv: { ...GLM_ENV, API_TIMEOUT_MS: "1" },
        }),
      ),
    ).toThrow(/cannot switch/u);
    expect(() =>
      applyProfileEnv(env, first, {
        providerOptions: { claudeConfigDir: "/srv/claude-work" },
      }),
    ).toThrow(/cannot switch/u);
  });

  it("expands ~ in the token file", () => {
    const profile = applyProfileEnv({}, null, {
      providerOptions: {
        claudeAuthTokenFile: "~/.config/bb/glm.token",
        claudeEnv: GLM_ENV,
      },
    });

    expect(profile).toMatchObject({
      kind: "token",
      authTokenFile: expect.stringMatching(/^\/.*\/\.config\/bb\/glm\.token$/u),
    });
  });

  it.each([
    ["a credential key", { ...GLM_ENV, ANTHROPIC_API_KEY: "secret" }],
    ["the auth token key", { ...GLM_ENV, ANTHROPIC_AUTH_TOKEN: "secret" }],
    ["CLAUDE_CONFIG_DIR", { ...GLM_ENV, CLAUDE_CONFIG_DIR: "/x" }],
    ["no base URL", { ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]" }],
    [
      "only whitespace model values",
      {
        ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
        ANTHROPIC_MODEL: "   ",
      },
    ],
    [
      "only empty model values",
      {
        ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "",
      },
    ],
    [
      "a base URL with no model variable",
      { ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic" },
    ],
    ["userinfo in the base URL", { ANTHROPIC_BASE_URL: "https://u:p@x.test" }],
    ["a remote http base URL", { ANTHROPIC_BASE_URL: "http://x.test" }],
  ])("rejects %s in claudeEnv without touching env", (_label, claudeEnv) => {
    const env = ambientEnv();
    const before = { ...env };

    expect(() =>
      applyProfileEnv(env, null, tokenOptions({ claudeEnv })),
    ).toThrow();
    expect(env).toEqual(before);
  });

  it.each([
    ["a relative token file", { claudeAuthTokenFile: "glm.token" }],
    ["a .. segment", { claudeAuthTokenFile: "/srv/../glm.token" }],
    ["a shell character", { claudeAuthTokenFile: "/srv/$x" }],
  ])("rejects %s without touching env", (_label, overrides) => {
    const env = ambientEnv();
    const before = { ...env };

    expect(() => applyProfileEnv(env, null, tokenOptions(overrides))).toThrow();
    expect(env).toEqual(before);
  });

  it("rejects a token file without env, env without a token file, and mixed kinds", () => {
    const env = ambientEnv();
    const before = { ...env };

    expect(() =>
      applyProfileEnv(env, null, {
        providerOptions: { claudeAuthTokenFile: TOKEN_FILE },
      }),
    ).toThrow();
    expect(() =>
      applyProfileEnv(env, null, {
        providerOptions: { claudeEnv: GLM_ENV },
      }),
    ).toThrow();
    expect(() =>
      applyProfileEnv(
        env,
        null,
        tokenOptions({ claudeConfigDir: "/srv/claude-work" }),
      ),
    ).toThrow(/cannot be combined/u);
    expect(env).toEqual(before);
  });
});

describe("applyTokenProfileSessionEnv", () => {
  it("merges, strips every ANTHROPIC_ and config dir name, applies the profile env, then sets the token last", () => {
    const sessionEnv: NodeJS.ProcessEnv = {
      ...ambientEnv(),
      ANTHROPIC_AUTH_TOKEN: "from-config-envVars",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "project-opus",
      ANTHROPIC_FUTURE_ROUTING: "x",
      KEEP: "1",
    };

    applyTokenProfileSessionEnv(sessionEnv, TOKEN_PROFILE, "file-token");

    expect(sessionEnv).toEqual({
      PATH: "/usr/bin",
      HTTPS_PROXY: "http://proxy.test:3128",
      KEEP: "1",
      ...GLM_ENV,
      ANTHROPIC_AUTH_TOKEN: "file-token",
    });
    expect(sessionEnv.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBeUndefined();
  });

  it("lets the profile env win over a project ANTHROPIC_BASE_URL", () => {
    const sessionEnv: NodeJS.ProcessEnv = {
      ANTHROPIC_BASE_URL: "https://evil.example",
    };

    applyTokenProfileSessionEnv(sessionEnv, TOKEN_PROFILE, "t");

    expect(sessionEnv.ANTHROPIC_BASE_URL).toBe(GLM_ENV.ANTHROPIC_BASE_URL);
  });
});

describe("applyProfileSessionEnv for a token profile", () => {
  it("removes every ANTHROPIC_ name and the config dir without adding anything", () => {
    const env = ambientEnv();

    applyProfileSessionEnv(env, TOKEN_PROFILE);

    expect(env).toEqual({
      PATH: "/usr/bin",
      HTTPS_PROXY: "http://proxy.test:3128",
    });
  });
});
