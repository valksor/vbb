import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExperimentalVendorPluginRoots } from "@get-bb/plugin-sdk/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveClaudeProviderNativeRoots } from "./native-roots.profile.fork.js";

interface Fixture {
  cwd: string;
  homeDir: string;
  claudeDir: string;
}

let tempRoot: string;

async function makeFixture(): Promise<Fixture> {
  const homeDir = path.join(tempRoot, "home");
  const cwd = path.join(tempRoot, "workspace");
  await mkdir(homeDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  return { cwd, homeDir, claudeDir: path.join(homeDir, ".claude") };
}

function skillPaths(roots: ExperimentalVendorPluginRoots): string[] {
  return roots.skills.map((root) => root.path);
}

function commandPaths(roots: ExperimentalVendorPluginRoots): string[] {
  return roots.commands.map((root) => root.path);
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "bb-claude-native-roots-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("resolveClaudeProviderNativeRoots", () => {
  it("resolves a profile's skills and commands under its config dir, not ~/.claude", async () => {
    const fixture = await makeFixture();
    const profileDir = path.join(fixture.homeDir, ".claude-work");

    const roots = await resolveClaudeProviderNativeRoots({
      cwd: fixture.cwd,
      bridgeOptions: { claudeConfigDir: "~/.claude-work" },
      homeDir: fixture.homeDir,
      env: {},
    });

    expect(skillPaths(roots)).toEqual([path.join(profileDir, "skills")]);
    expect(commandPaths(roots)).toEqual([path.join(profileDir, "commands")]);
    expect(skillPaths(roots)).not.toContain(
      path.join(fixture.claudeDir, "skills"),
    );
  });

  it("lets the profile dir win over an ambient CLAUDE_CONFIG_DIR", async () => {
    const fixture = await makeFixture();

    const roots = await resolveClaudeProviderNativeRoots({
      cwd: null,
      bridgeOptions: { claudeConfigDir: "~/.claude-work" },
      homeDir: fixture.homeDir,
      env: { CLAUDE_CONFIG_DIR: path.join(fixture.homeDir, "ambient") },
    });

    expect(skillPaths(roots)).toEqual([
      path.join(fixture.homeDir, ".claude-work", "skills"),
    ]);
  });

  it("resolves the default ~/.claude roots for a token profile even with an ambient CLAUDE_CONFIG_DIR", async () => {
    const fixture = await makeFixture();

    const roots = await resolveClaudeProviderNativeRoots({
      cwd: null,
      bridgeOptions: {
        claudeAuthTokenFile: "~/.config/bb/glm.token",
        claudeEnv: {
          ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
        },
      },
      homeDir: fixture.homeDir,
      env: { CLAUDE_CONFIG_DIR: path.join(fixture.homeDir, "ambient") },
    });

    expect(skillPaths(roots)).toEqual([path.join(fixture.claudeDir, "skills")]);
    expect(commandPaths(roots)).toEqual([
      path.join(fixture.claudeDir, "commands"),
    ]);
  });

  it("rejects token bridge options the profile schema would reject", async () => {
    const fixture = await makeFixture();

    await expect(
      resolveClaudeProviderNativeRoots({
        cwd: null,
        bridgeOptions: {
          claudeAuthTokenFile: "~/.config/bb/glm.token",
          claudeEnv: { ANTHROPIC_API_KEY: "secret" },
        },
        homeDir: fixture.homeDir,
        env: {},
      }),
    ).rejects.toThrow();
    await expect(
      resolveClaudeProviderNativeRoots({
        cwd: null,
        bridgeOptions: { claudeAuthTokenFile: "~/.config/bb/glm.token" },
        homeDir: fixture.homeDir,
        env: {},
      }),
    ).rejects.toThrow();
  });

  it("resolves the default roots when the provider has no bridge options", async () => {
    const fixture = await makeFixture();

    for (const bridgeOptions of [undefined, {}]) {
      const roots = await resolveClaudeProviderNativeRoots({
        cwd: null,
        bridgeOptions,
        homeDir: fixture.homeDir,
        env: {},
      });
      expect(skillPaths(roots)).toEqual([
        path.join(fixture.claudeDir, "skills"),
      ]);
    }
  });

  it("rejects a malformed or invalid claudeConfigDir instead of falling back to ~/.claude", async () => {
    const fixture = await makeFixture();
    const resolveWith = (bridgeOptions: Record<string, unknown>) =>
      resolveClaudeProviderNativeRoots({
        cwd: null,
        bridgeOptions,
        homeDir: fixture.homeDir,
        env: {},
      });

    await expect(resolveWith({ claudeConfigDir: 7 })).rejects.toThrow();
    await expect(resolveWith({ claudeConfigDir: "relative" })).rejects.toThrow(
      "absolute path",
    );
    await expect(resolveWith({ claudeConfigDir: "~" })).rejects.toThrow(
      "home directory",
    );
  });
});
