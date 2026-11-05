import { describe, expect, it, vi } from "vitest";
import type { PluginProviderOptionsContext } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import claudeCodePlugin from "../server.js";
import { claudeCodeProviderDeclaration } from "./declaration.js";

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
