import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const keychainCalls = vi.hoisted(() => ({ services: [] as string[] }));

vi.mock("@get-bb/plugin-sdk/process", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@get-bb/plugin-sdk/process")
  >()),
  experimental_execHostFile: (
    _command: string,
    args: readonly string[],
  ) => {
    keychainCalls.services.push(args[args.indexOf("-s") + 1] ?? "");
    return Promise.reject(new Error("keychain item not found"));
  },
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@get-bb/plugin-sdk/provider-bridge")
  >()),
  experimental_resolveExecutablePath: () => Promise.resolve("/test/claude"),
  experimental_readCliVersion: () => Promise.resolve("2.1.0"),
}));

import { claudeConfigDirKeychainService } from "../config-dir.js";
import {
  getClaudeProviderHealth,
  getClaudeProviderUsage,
} from "./provider-maintenance.js";

const originalPlatform = process.platform;
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeLogin(args: {
  dir: string;
  email: string;
  claudeJsonDir: string;
}) {
  mkdirSync(args.dir, { recursive: true });
  writeFileSync(
    join(args.dir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "test-access-token",
        expiresAt: null,
        subscriptionType: "max",
        rateLimitTier: "default_claude_max_5x",
      },
    }),
  );
  writeFileSync(
    join(args.claudeJsonDir, ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: args.email } }),
  );
}

beforeAll(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "darwin",
  });
});
afterAll(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: originalPlatform,
  });
});
beforeEach(() => {
  keychainCalls.services.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("profile-bound provider maintenance", () => {
  it("reads credentials and account from the profile dir", async () => {
    const home = tempDir("bb-claude-home-");
    vi.stubEnv("HOME", home);
    const profile = join(tempDir("bb-claude-profile-"), "work");
    writeLogin({
      dir: profile,
      email: "work@example.com",
      claudeJsonDir: profile,
    });

    const result = await getClaudeProviderHealth({
      kind: "login",
      configDir: profile,
    });

    expect(result.supported && result.health).toMatchObject({
      status: "ready",
      accountEmail: "work@example.com",
      planLabel: "Max",
      loginCommand: `CLAUDE_CONFIG_DIR='${profile}' claude auth login`,
    });
  });

  it("queries only the keychain service hashed from the loginCommand path", async () => {
    const home = tempDir("bb-claude-home-");
    vi.stubEnv("HOME", home);
    const profile = join(tempDir("bb-claude-profile-"), "work");
    mkdirSync(profile, { recursive: true });

    const result = await getClaudeProviderHealth({
      kind: "login",
      configDir: profile,
    });

    const loginCommand = result.supported ? result.health.loginCommand : null;
    const loginPath = /^CLAUDE_CONFIG_DIR='(.*)' claude auth login$/u.exec(
      loginCommand ?? "",
    )?.[1];
    expect(loginPath).toBe(profile);
    expect(keychainCalls.services.length).toBeGreaterThan(0);
    expect(new Set(keychainCalls.services)).toEqual(
      new Set([claudeConfigDirKeychainService(loginPath ?? "")]),
    );
  });

  it("never falls back to the default login when the profile has none", async () => {
    const home = tempDir("bb-claude-home-");
    vi.stubEnv("HOME", home);
    writeLogin({
      dir: join(home, ".claude"),
      email: "personal@example.com",
      claudeJsonDir: home,
    });
    const profile = join(tempDir("bb-claude-profile-"), "work");
    mkdirSync(profile, { recursive: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const health = await getClaudeProviderHealth({
      kind: "login",
      configDir: profile,
    });
    const usage = await getClaudeProviderUsage({
      kind: "login",
      configDir: profile,
    });

    expect(health.supported && health.health).toMatchObject({
      status: "unauthenticated",
      accountEmail: null,
    });
    expect(usage).toEqual({
      supported: true,
      usage: { status: "unauthenticated" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keychainCalls.services).not.toContain("Claude Code-credentials");
  });

  it("keeps default behavior without a profile", async () => {
    const home = tempDir("bb-claude-home-");
    vi.stubEnv("HOME", home);
    writeLogin({
      dir: join(home, ".claude"),
      email: "personal@example.com",
      claudeJsonDir: home,
    });

    const result = await getClaudeProviderHealth();

    expect(result.supported && result.health).toMatchObject({
      status: "ready",
      accountEmail: "personal@example.com",
      loginCommand: "claude auth login",
    });
    expect(new Set(keychainCalls.services)).toEqual(
      new Set(["Claude Code-credentials"]),
    );
  });
});
