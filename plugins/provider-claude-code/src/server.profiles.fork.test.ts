import { describe, expect, it, vi } from "vitest";
import type { PluginProviderOptionsContext } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import claudeCodePlugin from "../server.js";
import { claudeCodeProviderDeclaration } from "./declaration.js";
import { buildClaudeProviderErrorInfo } from "./error-info.js";

function loadClaudeCodePlugin() {
  const host = createFakePluginHost({ pluginId: "provider-claude-code" });
  void claudeCodePlugin(host.bb);
  const declaration = host.harness.registrations.providerRegistrations.find(
    (entry) => entry.id === "claude-code",
  );
  if (declaration === undefined) {
    throw new Error("expected Claude Code to be registered");
  }
  return { declaration, host };
}

function providerOptions(
  declaration: ReturnType<typeof loadClaudeCodePlugin>["declaration"],
  settings: PluginProviderOptionsContext["settings"],
) {
  const deriveProviderOptions = declaration.deriveProviderOptions;
  if (deriveProviderOptions === undefined) {
    throw new Error("expected Claude Code provider options");
  }
  return deriveProviderOptions({
    threadId: "thread-1",
    projectId: "project-1",
    model: "claude-sonnet-5",
    permissionMode: "accept-edits",
    settings,
  });
}

type FakeHost = ReturnType<typeof createFakePluginHost>;

const WORK_PROFILE = {
  id: "work",
  displayName: "Claude Work (native)",
  configDir: "~/.claude-work",
};

function profilesSetting(...profiles: unknown[]): string {
  return JSON.stringify(profiles);
}

async function loadWithProfiles(profiles?: string): Promise<FakeHost> {
  const host = createFakePluginHost({
    pluginId: "provider-claude-code",
    ...(profiles === undefined ? {} : { settings: { profiles } }),
  });
  await claudeCodePlugin(host.bb);
  return host;
}

function registeredIds(host: FakeHost): string[] {
  return host.harness.registrations.providerRegistrations.map(
    (declaration) => declaration.id,
  );
}

function registration(host: FakeHost, id: string) {
  const declaration = host.harness.registrations.providerRegistrations.find(
    (entry) => entry.id === id,
  );
  if (declaration === undefined) {
    throw new Error(`expected ${id} to be registered`);
  }
  return declaration;
}

function warned(host: FakeHost, fragment: string): boolean {
  return host.harness.logEntries.some((entry) =>
    entry.message.includes(fragment),
  );
}

describe("the default Claude Code declaration", () => {
  it("is registered before the factory's first await", async () => {
    const host = createFakePluginHost({ pluginId: "provider-claude-code" });

    const loading = claudeCodePlugin(host.bb);
    expect(registeredIds(host)).toEqual(["claude-code"]);
    await loading;
  });

  it("is unchanged by the profile support", () => {
    const { deriveProviderOptions: _derive, ...rest } =
      claudeCodeProviderDeclaration();

    expect(rest).toEqual({
      id: "claude-code",
      displayName: "Claude Code",
      icon: "./icons/claude-code.svg",
      strings: {
        signInHint: "Run `claude` on the machine to sign in.",
        expiredHint: "Your Claude session expired. Run `claude`, then reload.",
        installUrl: "https://claude.com/claude-code",
        brandPrefix: "Claude ",
        planModeCopy:
          "Claude Code will plan without normal full-access execution.",
        iconTint: { light: "#D97757", dark: "#D97757" },
      },
      experimental_nativeSkillRoots: {
        user: [
          {
            path: ".claude/skills",
            skipIfManifest: ".claude-plugin/plugin.json",
          },
        ],
        project: [
          {
            path: ".claude/skills",
            ancestors: true,
            skipIfManifest: ".claude-plugin/plugin.json",
          },
        ],
      },
      experimental_nativeCommandRoots: {
        project: [".claude/commands"],
      },
      experimental_resolvesNativeRoots: true,
      maintenance: { health: true, usage: true, installation: true },
      capabilities: {
        supportsServiceTier: true,
        supportsNativeUserQuestion: true,
        fork: "checkpoint",
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ["accept-edits", "auto", "full"],
        reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
      },
      reasoningLevels: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
        {
          id: "ultracode",
          label: "Ultracode",
          description:
            "Extra-high effort plus standing workflow orchestration.",
        },
        { id: "max", label: "Max" },
      ],
      serviceTiers: [
        { id: "default", label: "Default" },
        {
          id: "fast",
          label: "Fast",
          description:
            "Faster responses on supported Opus models at a higher cost per token.",
        },
      ],
      composerActions: ["plan"],
      completedTurnDisplay: "flat",
      env: {
        passthrough: ["BB_CLAUDE_CODE_EXECUTABLE", "CLAUDE_CODE_OAUTH_TOKEN"],
      },
      models: { scope: "host" },
    });
  });
});

describe("the Claude Code profiles setting", () => {
  it("is an empty multiline string by default", async () => {
    const host = await loadWithProfiles();

    expect(
      host.harness.registrations.settingsDescriptors.profiles,
    ).toMatchObject({
      type: "string",
      label: "Profiles",
      experimental_multiline: true,
      default: "",
    });
    expect(registeredIds(host)).toEqual(["claude-code"]);
  });

  it("registers a native provider bound to the profile's config dir", async () => {
    const host = await loadWithProfiles(profilesSetting(WORK_PROFILE));

    const profile = registration(host, "claude-code-work");
    expect(profile).toMatchObject({
      displayName: "Claude Work (native)",
      family: "claude-code",
      experimental_bridgeOptions: { claudeConfigDir: "~/.claude-work" },
      experimental_resolvesNativeRoots: true,
      maintenance: { health: true, usage: true, installation: false },
      env: { passthrough: ["BB_CLAUDE_CODE_EXECUTABLE"] },
      capabilities: registration(host, "claude-code").capabilities,
      icon: registration(host, "claude-code").icon,
    });
    expect(
      providerOptions(profile, { chromeEnabled: true }).chromeEnabled,
    ).toBe(true);
  });

  it("drops the home-relative user skill root and keeps the project roots", async () => {
    const host = await loadWithProfiles(profilesSetting(WORK_PROFILE));

    const profile = registration(host, "claude-code-work");
    const standard = registration(host, "claude-code");
    expect(profile.experimental_nativeSkillRoots?.user).toEqual([]);
    expect(standard.experimental_nativeSkillRoots?.user).toHaveLength(1);
    expect(profile.experimental_nativeSkillRoots?.project).toEqual(
      standard.experimental_nativeSkillRoots?.project,
    );
    expect(profile.experimental_nativeCommandRoots).toEqual(
      standard.experimental_nativeCommandRoots,
    );
  });

  it("spells the sign-in command in a shell-neutral form", async () => {
    const host = await loadWithProfiles(
      profilesSetting(WORK_PROFILE, {
        id: "abs",
        displayName: "Absolute",
        configDir: "/srv/claude profile",
      }),
    );

    expect(registration(host, "claude-code-work").strings).toMatchObject({
      signInHint:
        'Run `CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude auth login` on the machine to sign in.',
      expiredHint:
        'Your Claude session expired. Run `CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude auth login`, then reload.',
    });
    expect(registration(host, "claude-code-abs").strings).toMatchObject({
      signInHint:
        "Run `CLAUDE_CONFIG_DIR='/srv/claude profile' claude auth login` on the machine to sign in.",
    });
  });

  it("adds, updates and removes profiles with the setting", async () => {
    const host = await loadWithProfiles(profilesSetting(WORK_PROFILE));
    expect(registeredIds(host)).toEqual(["claude-code", "claude-code-work"]);

    await host.harness.setSettings({
      profiles: profilesSetting(
        { ...WORK_PROFILE, displayName: "Renamed" },
        { id: "other", displayName: "Other", configDir: "~/.claude-other" },
      ),
    });
    await vi.waitFor(() =>
      expect(registeredIds(host)).toEqual([
        "claude-code",
        "claude-code-work",
        "claude-code-other",
      ]),
    );
    expect(registration(host, "claude-code-work").displayName).toBe("Renamed");

    await host.harness.setSettings({ profiles: "" });
    await vi.waitFor(() =>
      expect(registeredIds(host)).toEqual(["claude-code"]),
    );
  });

  it("leaves an unchanged profile's registration alone across a save", async () => {
    const host = await loadWithProfiles(profilesSetting(WORK_PROFILE));
    const before = registration(host, "claude-code-work");

    await host.harness.setSettings({
      profiles: profilesSetting(WORK_PROFILE, {
        id: "other",
        displayName: "Other",
        configDir: "~/.claude-other",
      }),
    });
    await vi.waitFor(() =>
      expect(registeredIds(host)).toContain("claude-code-other"),
    );

    expect(registration(host, "claude-code-work")).toBe(before);
  });

  it.each([
    [
      "an invalid id",
      { id: "Bad Id", displayName: "x", configDir: "~/.x" },
      "id must match",
    ],
    [
      "a trailing hyphen in the id",
      { id: "work-", displayName: "x", configDir: "~/.x" },
      "id must match",
    ],
    [
      "a doubled hyphen in the id",
      { id: "a--b", displayName: "x", configDir: "~/.x" },
      "id must match",
    ],
    [
      "an id longer than 41 characters",
      { id: "a".repeat(42), displayName: "x", configDir: "~/.x" },
      "id",
    ],
    [
      "a blank display name",
      { id: "blank", displayName: "  ", configDir: "~/.x" },
      "displayName must be non-blank",
    ],
    [
      "the home directory",
      { id: "home", displayName: "x", configDir: "~" },
      "must not be the home directory",
    ],
    [
      "a trailing-slash home directory",
      { id: "home", displayName: "x", configDir: "~/" },
      "must not be the home directory",
    ],
    [
      "a relative path",
      { id: "rel", displayName: "x", configDir: "dir" },
      "absolute path",
    ],
    [
      "a .. segment",
      { id: "dots", displayName: "x", configDir: "~/a/../b" },
      "path segment",
    ],
    [
      "a trailing slash",
      { id: "slash", displayName: "x", configDir: "~/.x/" },
      "trailing /",
    ],
    [
      "an empty segment",
      { id: "empty", displayName: "x", configDir: "/srv//x" },
      "empty path segment",
    ],
    [
      "a . segment",
      { id: "dot", displayName: "x", configDir: "~/./x" },
      ". path segment",
    ],
    [
      "a control character",
      { id: "ctl", displayName: "x", configDir: "~/a\nb" },
      "control or bidi character",
    ],
    [
      "a shell-active character",
      { id: "quote", displayName: "x", configDir: "~/it's" },
      "character '",
    ],
    [
      "an unknown field",
      { ...WORK_PROFILE, id: "extra", extra: true },
      "extra",
    ],
  ])(
    "skips an entry with %s and keeps the rest",
    async (_label, bad, fragment) => {
      const host = await loadWithProfiles(profilesSetting(bad, WORK_PROFILE));

      expect(registeredIds(host)).toEqual(["claude-code", "claude-code-work"]);
      expect(warned(host, fragment)).toBe(true);
    },
  );

  it("skips a repeated id", async () => {
    const host = await loadWithProfiles(
      profilesSetting(WORK_PROFILE, { ...WORK_PROFILE, displayName: "Again" }),
    );

    expect(registeredIds(host)).toEqual(["claude-code", "claude-code-work"]);
    expect(registration(host, "claude-code-work").displayName).toBe(
      "Claude Work (native)",
    );
    expect(warned(host, 'repeats the id "work"')).toBe(true);
  });

  it.each(["not json", '{"id":"work"}'])(
    "registers no profiles for the unusable value %j",
    async (value) => {
      const host = await loadWithProfiles(value);

      expect(registeredIds(host)).toEqual(["claude-code"]);
      expect(warned(host, "ignoring it")).toBe(true);
    },
  );

  it("rejects an invalid value through the setting's schema", async () => {
    const host = await loadWithProfiles();
    const schema =
      host.harness.registrations.settingsDescriptors.profiles
        ?.experimental_schema;
    if (schema === undefined) {
      throw new Error("expected a profiles schema");
    }
    const validate = (value: string) => schema["~standard"].validate(value);

    expect(await validate("")).not.toHaveProperty("issues");
    expect(await validate(profilesSetting(WORK_PROFILE))).not.toHaveProperty(
      "issues",
    );
    expect(
      await validate(
        profilesSetting({ id: "x", displayName: "x", configDir: "~/a$b" }),
      ),
    ).toHaveProperty("issues");
  });

  it("disposes the profile registrations with the plugin", async () => {
    const host = await loadWithProfiles(profilesSetting(WORK_PROFILE));

    await host.harness.lifecycle.dispose();

    expect(registeredIds(host)).toEqual([]);
  });

  it("registers nothing for a change queued behind a dispose", async () => {
    const host = await loadWithProfiles();

    const change = host.harness.setSettings({
      profiles: profilesSetting(WORK_PROFILE),
    });
    await host.harness.lifecycle.dispose();
    await change;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(registeredIds(host)).toEqual([]);
  });

  it("derives Approvals in Full Access for a profile provider", async () => {
    const host = await loadWithProfiles(profilesSetting(WORK_PROFILE));
    const profile = registration(host, "claude-code-work");

    expect(providerOptions(profile, {}).fullAccessApprovalsEnabled).toBe(false);
    expect(
      providerOptions(profile, { fullAccessApprovalsEnabled: true })
        .fullAccessApprovalsEnabled,
    ).toBe(true);
  });
});

const GLM_ENV = {
  ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3-flashx[1m]",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.3-flash[1m]",
  API_TIMEOUT_MS: "3000000",
};

const GLM_PROFILE = {
  id: "glm",
  displayName: "GLM (native)",
  authTokenFile: "~/.config/bb/glm.token",
  env: GLM_ENV,
};

describe("token profiles", () => {
  it("registers a native provider carrying the token file and env as bridge options", async () => {
    const host = await loadWithProfiles(
      profilesSetting(WORK_PROFILE, GLM_PROFILE),
    );

    const profile = registration(host, "claude-code-glm");
    expect(profile).toMatchObject({
      displayName: "GLM (native)",
      family: "claude-code",
      experimental_bridgeOptions: {
        claudeAuthTokenFile: "~/.config/bb/glm.token",
        claudeEnv: GLM_ENV,
      },
      experimental_resolvesNativeRoots: true,
      maintenance: { health: true, usage: true, installation: false },
      env: { passthrough: ["BB_CLAUDE_CODE_EXECUTABLE"] },
    });
    expect(profile.experimental_bridgeOptions).not.toHaveProperty(
      "claudeConfigDir",
    );
  });

  it("offers neither Auto mode nor the Fast tier but keeps reasoning levels", async () => {
    const host = await loadWithProfiles(profilesSetting(GLM_PROFILE));

    const profile = registration(host, "claude-code-glm");
    const standard = registration(host, "claude-code");
    expect(profile.capabilities.permissionModes).toEqual([
      "accept-edits",
      "full",
    ]);
    expect(standard.capabilities.permissionModes).toEqual([
      "accept-edits",
      "auto",
      "full",
    ]);
    expect(profile.capabilities.supportsServiceTier).toBe(false);
    expect(profile.serviceTiers).toBeUndefined();
    expect(profile.capabilities.reasoningLevels).toEqual(
      standard.capabilities.reasoningLevels,
    );
    expect(profile.reasoningLevels).toEqual(standard.reasoningLevels);
    expect(profile.capabilities.supportsNativeUserQuestion).toBe(true);
    expect(profile.capabilities.fork).toBe("checkpoint");
  });

  it("keeps the default user skill roots because it shares ~/.claude", async () => {
    const host = await loadWithProfiles(
      profilesSetting(WORK_PROFILE, GLM_PROFILE),
    );

    const glm = registration(host, "claude-code-glm");
    const standard = registration(host, "claude-code");
    expect(glm.experimental_nativeSkillRoots).toEqual(
      standard.experimental_nativeSkillRoots,
    );
    expect(
      registration(host, "claude-code-work").experimental_nativeSkillRoots,
    ).not.toEqual(standard.experimental_nativeSkillRoots);
  });

  it("points sign-in and expiry at the token file instead of a login command", async () => {
    const host = await loadWithProfiles(profilesSetting(GLM_PROFILE));

    const hint =
      "Put the API token for this profile in ~/.config/bb/glm.token (chmod 600), then reload.";
    expect(registration(host, "claude-code-glm").strings).toMatchObject({
      signInHint: hint,
      expiredHint: hint,
    });
  });

  it("maps a 401 from the endpoint to the unauthorized category the token hint is shown for", async () => {
    const host = await loadWithProfiles(profilesSetting(GLM_PROFILE));

    expect(buildClaudeProviderErrorInfo({ httpStatusCode: 401 })).toMatchObject(
      { category: "unauthorized", httpStatusCode: 401 },
    );
    expect(
      buildClaudeProviderErrorInfo({ code: "authentication_failed" }),
    ).toMatchObject({ category: "unauthorized" });
    expect(registration(host, "claude-code-glm").strings?.expiredHint).toBe(
      "Put the API token for this profile in ~/.config/bb/glm.token (chmod 600), then reload.",
    );
  });

  it("leaves the work profile and the default declaration unchanged beside a token profile", async () => {
    const withToken = await loadWithProfiles(
      profilesSetting(WORK_PROFILE, GLM_PROFILE),
    );
    const withoutToken = await loadWithProfiles(profilesSetting(WORK_PROFILE));

    for (const id of ["claude-code", "claude-code-work"]) {
      const { deriveProviderOptions: _left, ...left } = registration(
        withToken,
        id,
      );
      const { deriveProviderOptions: _right, ...right } = registration(
        withoutToken,
        id,
      );
      expect(left).toEqual(right);
    }
    expect(registration(withToken, "claude-code-work")).toMatchObject({
      experimental_bridgeOptions: { claudeConfigDir: "~/.claude-work" },
      maintenance: { health: true, usage: true, installation: false },
      capabilities: {
        permissionModes: ["accept-edits", "auto", "full"],
        supportsServiceTier: true,
      },
    });
  });

  it("keeps the 1M context and memory options in the derived provider options", async () => {
    const host = await loadWithProfiles(profilesSetting(GLM_PROFILE));

    const options = providerOptions(registration(host, "claude-code-glm"), {
      disable1MContext: true,
      memoryEnabled: false,
    });
    expect(options).toMatchObject({
      disable1MContext: true,
      memoryEnabled: false,
    });
  });

  it.each([
    [
      "both configDir and token fields",
      { ...GLM_PROFILE, configDir: "~/.claude-glm" },
      "configDir cannot be combined",
    ],
    [
      "configDir and env",
      {
        id: "mix",
        displayName: "x",
        configDir: "~/.claude-glm",
        env: GLM_ENV,
      },
      "configDir cannot be combined",
    ],
    [
      "neither configDir nor token fields",
      { id: "none", displayName: "x" },
      "needs configDir",
    ],
    [
      "a base URL without a token file",
      { id: "nofile", displayName: "x", env: GLM_ENV },
      "authTokenFile",
    ],
    [
      "a token file without env",
      { id: "noenv", displayName: "x", authTokenFile: "~/.config/bb/t" },
      "env",
    ],
    [
      "env without any model variable",
      {
        ...GLM_PROFILE,
        env: { ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic" },
      },
      "non-empty value for at least one model",
    ],
    [
      "an empty model value",
      {
        ...GLM_PROFILE,
        env: {
          ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "",
          ANTHROPIC_MODEL: "   ",
        },
      },
      "non-empty value for at least one model",
    ],
    [
      "env without a base URL",
      {
        ...GLM_PROFILE,
        env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]" },
      },
      "ANTHROPIC_BASE_URL is required",
    ],
    [
      "a relative token file",
      { ...GLM_PROFILE, authTokenFile: "glm.token" },
      "authTokenFile must be an absolute path",
    ],
    [
      "a .. segment in the token file",
      { ...GLM_PROFILE, authTokenFile: "~/a/../glm.token" },
      "authTokenFile must not contain a .. path segment",
    ],
    [
      "a . segment in the token file",
      { ...GLM_PROFILE, authTokenFile: "~/./glm.token" },
      "authTokenFile must not contain a . path segment",
    ],
    [
      "a shell character in the token file",
      { ...GLM_PROFILE, authTokenFile: "~/$HOME/glm.token" },
      "authTokenFile must not contain the character $",
    ],
    [
      "a control character in the token file",
      { ...GLM_PROFILE, authTokenFile: "~/glm\n.token" },
      "authTokenFile must not contain a control",
    ],
    [
      "the home directory as the token file",
      { ...GLM_PROFILE, authTokenFile: "~" },
      "authTokenFile must not be the home directory",
    ],
    [
      "a trailing slash on the token file",
      { ...GLM_PROFILE, authTokenFile: "~/glm.token/" },
      "authTokenFile must not end with a trailing /",
    ],
    [
      "ANTHROPIC_AUTH_TOKEN in env",
      { ...GLM_PROFILE, env: { ...GLM_ENV, ANTHROPIC_AUTH_TOKEN: "secret" } },
      "env.ANTHROPIC_AUTH_TOKEN is not allowed",
    ],
    [
      "ANTHROPIC_API_KEY in env",
      { ...GLM_PROFILE, env: { ...GLM_ENV, ANTHROPIC_API_KEY: "secret" } },
      "env.ANTHROPIC_API_KEY is not allowed",
    ],
    [
      "CLAUDE_CONFIG_DIR in env",
      { ...GLM_PROFILE, env: { ...GLM_ENV, CLAUDE_CONFIG_DIR: "/x" } },
      "env.CLAUDE_CONFIG_DIR is not allowed",
    ],
    [
      "a stripped credential key in env",
      { ...GLM_PROFILE, env: { ...GLM_ENV, CLAUDE_CODE_OAUTH_TOKEN: "t" } },
      "env.CLAUDE_CODE_OAUTH_TOKEN is not allowed",
    ],
    [
      "a proxy variable in env",
      { ...GLM_PROFILE, env: { ...GLM_ENV, HTTPS_PROXY: "http://evil" } },
      "env.HTTPS_PROXY is not allowed",
    ],
    [
      "an unknown ANTHROPIC_ key in env",
      { ...GLM_PROFILE, env: { ...GLM_ENV, ANTHROPIC_FUTURE_ROUTING: "x" } },
      "env.ANTHROPIC_FUTURE_ROUTING is not allowed",
    ],
    [
      "a control character in an env value",
      {
        ...GLM_PROFILE,
        env: { ...GLM_ENV, ANTHROPIC_DEFAULT_OPUS_MODEL: "glm‮" },
      },
      "env.ANTHROPIC_DEFAULT_OPUS_MODEL must not contain a control",
    ],
    [
      "an http base URL on a remote host",
      { ...GLM_PROFILE, env: { ANTHROPIC_BASE_URL: "http://api.z.ai/x" } },
      "may use http only for localhost",
    ],
    [
      "userinfo in the base URL",
      {
        ...GLM_PROFILE,
        env: { ANTHROPIC_BASE_URL: "https://user:pw@api.z.ai/x" },
      },
      "must not contain userinfo",
    ],
    [
      "a query in the base URL",
      { ...GLM_PROFILE, env: { ANTHROPIC_BASE_URL: "https://api.z.ai/x?a=1" } },
      "must not contain a query or fragment",
    ],
    [
      "a fragment in the base URL",
      { ...GLM_PROFILE, env: { ANTHROPIC_BASE_URL: "https://api.z.ai/x#a" } },
      "must not contain a query or fragment",
    ],
    [
      "a localhost lookalike host over http",
      {
        ...GLM_PROFILE,
        env: { ANTHROPIC_BASE_URL: "http://localhost.evil.tld/x" },
      },
      "may use http only for localhost",
    ],
    [
      "an @-trick over http",
      {
        ...GLM_PROFILE,
        env: { ANTHROPIC_BASE_URL: "http://127.0.0.1@evil.example/x" },
      },
      "may use http only for localhost",
    ],
    [
      "a non-http scheme",
      { ...GLM_PROFILE, env: { ANTHROPIC_BASE_URL: "ftp://api.z.ai/x" } },
      "must use https",
    ],
    [
      "a base URL that is not a URL",
      { ...GLM_PROFILE, env: { ANTHROPIC_BASE_URL: "api.z.ai" } },
      "must be an absolute URL",
    ],
  ])(
    "skips an entry with %s and keeps the rest",
    async (_label, bad, fragment) => {
      const host = await loadWithProfiles(profilesSetting(bad, WORK_PROFILE));

      expect(registeredIds(host)).toEqual(["claude-code", "claude-code-work"]);
      expect(warned(host, fragment)).toBe(true);
    },
  );

  it.each([
    "http://localhost:8080/anthropic",
    "http://127.0.0.1:8080",
    "http://[::1]:8080/x",
    "https://api.z.ai/api/anthropic",
  ])("accepts the base URL %s", async (baseUrl) => {
    const host = await loadWithProfiles(
      profilesSetting({
        ...GLM_PROFILE,
        env: {
          ANTHROPIC_BASE_URL: baseUrl,
          ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
        },
      }),
    );

    expect(registeredIds(host)).toEqual(["claude-code", "claude-code-glm"]);
  });

  it("accepts every allowlisted env variable", async () => {
    const env = {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_MODEL: "glm-5.3",
      ANTHROPIC_SMALL_FAST_MODEL: "glm-5.3-flash",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "GLM 5.3",
      ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION: "Balanced",
      ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: "thinking",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "glm-5.3",
      ANTHROPIC_CUSTOM_MODEL_OPTION: "glm-x",
      ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: "GLM X",
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000",
    };
    const host = await loadWithProfiles(
      profilesSetting({ ...GLM_PROFILE, env }),
    );

    expect(registeredIds(host)).toEqual(["claude-code", "claude-code-glm"]);
    expect(warned(host, "not valid")).toBe(false);
  });

  it("rejects an invalid token profile through the setting's schema", async () => {
    const host = await loadWithProfiles();
    const schema =
      host.harness.registrations.settingsDescriptors.profiles
        ?.experimental_schema;
    if (schema === undefined) {
      throw new Error("expected a profiles schema");
    }
    const validate = (value: string) => schema["~standard"].validate(value);

    expect(await validate(profilesSetting(GLM_PROFILE))).not.toHaveProperty(
      "issues",
    );
    expect(
      await validate(
        profilesSetting({
          ...GLM_PROFILE,
          env: { ...GLM_ENV, ANTHROPIC_AUTH_TOKEN: "secret" },
        }),
      ),
    ).toHaveProperty("issues");
  });

  it("does not repeat field names in the skip warnings", async () => {
    const host = await loadWithProfiles(
      profilesSetting(
        {
          ...GLM_PROFILE,
          id: "badenv",
          env: { ...GLM_ENV, ANTHROPIC_API_KEY: "secret" },
        },
        { ...GLM_PROFILE, id: "badfile", authTokenFile: "glm.token" },
      ),
    );

    const messages = host.harness.logEntries.map((entry) => entry.message);
    expect(messages.some((message) => message.includes("env env."))).toBe(
      false,
    );
    expect(
      messages.some((message) =>
        message.includes("authTokenFile authTokenFile"),
      ),
    ).toBe(false);
    expect(
      messages.some((message) =>
        message.includes("env.ANTHROPIC_API_KEY is not allowed"),
      ),
    ).toBe(true);
    expect(
      messages.some((message) =>
        message.includes("authTokenFile must be an absolute path"),
      ),
    ).toBe(true);
  });

  it("describes both profile kinds in the setting description", async () => {
    const host = await loadWithProfiles();

    const description =
      host.harness.registrations.settingsDescriptors.profiles?.description;
    expect(description).toContain("configDir");
    expect(description).toContain("authTokenFile");
    expect(description).toContain("ANTHROPIC_BASE_URL");
    expect(description).toContain("ANTHROPIC_DEFAULT_OPUS_MODEL");
  });
});
