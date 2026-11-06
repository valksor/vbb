import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import profileEnvNames from "./profile-env-names.json";
import {
  buildSessionOptions,
  type BuildSessionOptionsArgs,
} from "./session-options.js";
import { buildTokenProfileFlagSettings } from "./session-options.token.fork.js";

let isolatedHome: string;

beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "bb-token-test-home-"));
  vi.stubEnv("HOME", isolatedHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(isolatedHome, { recursive: true, force: true });
});

const GLM_ENV = {
  ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
  API_TIMEOUT_MS: "3000000",
};

const SESSION_ARGS: BuildSessionOptionsArgs = {
  cwd: "/tmp/worktree",
  instructionMode: "append",
  permissionMode: "acceptEdits",
  permissionScope: "workspace",
  serviceTier: "default",
  workflowsEnabled: false,
  chromeEnabled: false,
  disable1MContext: false,
  artifactsEnabled: false,
  sandboxEnabled: true,
};

describe("buildTokenProfileFlagSettings", () => {
  it("pins the whole profile env, an empty apiKeyHelper and the transport keys to the session env", () => {
    const settings = buildTokenProfileFlagSettings(GLM_ENV, {
      HTTPS_PROXY: "http://proxy.test:3128",
      NODE_EXTRA_CA_CERTS: "/etc/corp-ca.pem",
    });

    expect(settings.apiKeyHelper).toBe("");
    expect(settings.env).toMatchObject({
      ...GLM_ENV,
      HTTPS_PROXY: "http://proxy.test:3128",
      NODE_EXTRA_CA_CERTS: "/etc/corp-ca.pem",
      HTTP_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "",
      NODE_TLS_REJECT_UNAUTHORIZED: "",
      SSL_CERT_FILE: "",
      ANTHROPIC_UNIX_SOCKET: "",
    });
  });

  it("lets the profile env win over a pinned transport key", () => {
    const settings = buildTokenProfileFlagSettings(
      { ...GLM_ENV, ANTHROPIC_BASE_URL: "https://a.example" },
      { ANTHROPIC_BASE_URL: "https://b.example" },
    );

    expect(settings.env?.ANTHROPIC_BASE_URL).toBe("https://a.example");
  });
});

describe("buildSessionOptions flag settings", () => {
  it("adds the pins for a token profile and never the token", () => {
    const options = buildSessionOptions(
      SESSION_ARGS,
      { ANTHROPIC_AUTH_TOKEN: "file-token-value" },
      { env: GLM_ENV, settingsDir: "/tmp/private-dir" },
    );

    expect(options.tokenFlagSettingsDir).toBe("/tmp/private-dir");
    expect(options.settings).toMatchObject({
      autoMemoryEnabled: true,
      apiKeyHelper: "",
      env: GLM_ENV,
    });
    expect(JSON.stringify(options.settings)).not.toContain("file-token-value");
    expect(JSON.stringify(options.extraArgs ?? {})).not.toContain(
      "file-token-value",
    );
  });

  it("adds no env or apiKeyHelper pins without a token profile", () => {
    const options = buildSessionOptions(SESSION_ARGS, {});

    expect(options).not.toHaveProperty("tokenFlagSettingsDir");
    expect(options.settings).not.toHaveProperty("env");
    expect(options.settings).not.toHaveProperty("apiKeyHelper");
  });
});

describe("buildTokenProfileFlagSettings credential and routing pins", () => {
  const settings = () => buildTokenProfileFlagSettings(GLM_ENV, {});

  it("blanks every backend switch, backend base URL and backend auth skip", () => {
    const env = settings().env ?? {};

    for (const name of [
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CODE_USE_FOUNDRY",
      "CLAUDE_CODE_USE_MANTLE",
      "CLAUDE_CODE_USE_GATEWAY",
      "CLAUDE_CODE_USE_ANTHROPIC_AWS",
      "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
      "ANTHROPIC_BEDROCK_BASE_URL",
      "ANTHROPIC_VERTEX_BASE_URL",
      "ANTHROPIC_FOUNDRY_BASE_URL",
      "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
      "CLAUDE_CODE_SKIP_VERTEX_AUTH",
      "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "AWS_BEARER_TOKEN_BEDROCK",
    ]) {
      expect(env[name], name).toBe("");
    }
  });

  it("blanks every name the CLI fixture classifies as stripped except the profile env and the token", () => {
    const env = buildTokenProfileFlagSettings(GLM_ENV, {}).env ?? {};
    const stripped = Object.entries(profileEnvNames.names)
      .filter(([, classification]) => classification === "stripped")
      .map(([name]) => name);

    expect(stripped.length).toBeGreaterThan(50);
    for (const name of stripped) {
      if (name === "ANTHROPIC_AUTH_TOKEN") {
        expect(env).not.toHaveProperty(name);
      } else if (name in GLM_ENV) {
        expect(env[name], name).toBe(GLM_ENV[name as keyof typeof GLM_ENV]);
      } else {
        expect(env[name], name).toBe("");
      }
    }
  });

  it("leaves the kept feature toggles and model variables alone", () => {
    const env = settings().env ?? {};

    for (const name of [
      "CLAUDE_CODE_USE_NATIVE_FILE_SEARCH",
      "CLAUDE_CODE_USE_POWERSHELL_TOOL",
      "CLAUDE_CODE_USE_CCR_V2",
      "ANTHROPIC_MODEL",
      "ANTHROPIC_LOG",
      "CLAUDE_CODE_SKIP_AWS_CRED_CACHE",
    ]) {
      expect(env).not.toHaveProperty(name);
    }
  });
});

describe("transport pins read the user settings layer", () => {
  beforeEach(() => {
    mkdirSync(join(isolatedHome, ".claude"));
  });

  function writeUserSettings(content: string): void {
    writeFileSync(join(isolatedHome, ".claude", "settings.json"), content);
  }

  it("always pins ANTHROPIC_UNIX_SOCKET to an empty string, never from user settings or the bridge env", () => {
    writeUserSettings(
      JSON.stringify({ env: { ANTHROPIC_UNIX_SOCKET: "/tmp/user.sock" } }),
    );

    const env =
      buildTokenProfileFlagSettings(GLM_ENV, {
        ANTHROPIC_UNIX_SOCKET: "/tmp/bridge.sock",
      }).env ?? {};

    expect(env.ANTHROPIC_UNIX_SOCKET).toBe("");
  });

  it("prefers the user settings env, then the session env, then an empty string", () => {
    writeUserSettings(
      JSON.stringify({
        env: {
          HTTPS_PROXY: "http://corp-proxy.test:3128",
          NODE_EXTRA_CA_CERTS: "/etc/corp-ca.pem",
        },
      }),
    );

    const env =
      buildTokenProfileFlagSettings(GLM_ENV, {
        HTTPS_PROXY: "http://bridge-proxy.test:1",
        NO_PROXY: "internal.test",
      }).env ?? {};

    expect(env.HTTPS_PROXY).toBe("http://corp-proxy.test:3128");
    expect(env.NODE_EXTRA_CA_CERTS).toBe("/etc/corp-ca.pem");
    expect(env.NO_PROXY).toBe("internal.test");
    expect(env.HTTP_PROXY).toBe("");
    expect(env.SSL_CERT_FILE).toBe("");
  });

  it("keeps valid entries when another entry is invalid", () => {
    writeUserSettings(
      JSON.stringify({
        env: {
          HTTPS_PROXY: "http://corp-proxy.test:3128",
          NODE_TLS_REJECT_UNAUTHORIZED: 0,
          SSL_CERT_FILE: null,
          NO_PROXY: ["a", "b"],
          ALL_PROXY: { host: "x" },
          HTTP_PROXY: true,
        },
      }),
    );

    const env = buildTokenProfileFlagSettings(GLM_ENV, {}).env ?? {};

    expect(env.HTTPS_PROXY).toBe("http://corp-proxy.test:3128");
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
    expect(env.HTTP_PROXY).toBe("true");
    expect(env.SSL_CERT_FILE).toBe("");
    expect(env.NO_PROXY).toBe("");
    expect(env.ALL_PROXY).toBe("");
  });

  it.each([
    ["a missing file", undefined],
    ["invalid JSON", "{not json"],
    ["a non-object env", JSON.stringify({ env: "nope" })],
  ])("falls back to the session env for %s", (_label, content) => {
    if (content !== undefined) writeUserSettings(content);

    const env =
      buildTokenProfileFlagSettings(GLM_ENV, {
        HTTPS_PROXY: "http://bridge-proxy.test:1",
      }).env ?? {};

    expect(env.HTTPS_PROXY).toBe("http://bridge-proxy.test:1");
  });
});
