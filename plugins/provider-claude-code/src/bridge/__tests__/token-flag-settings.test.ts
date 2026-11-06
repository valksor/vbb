import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const TOKEN = "file-token-value-0123456789";
const PROFILE_ENV = {
  ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3-flashx[1m]",
};

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }));

import { listClaudeCodeBridgeModels } from "../model-list.js";
import { SdkSession, type SdkSessionOptions } from "../sdk-session.js";
import { buildSessionOptions } from "../session-options.js";
import { writeTokenFlagSettingsFile } from "../token-flag-settings.js";

let dir: string;
let isolatedHome: string;

const mockQueryInstance = {
  applyFlagSettings: vi.fn(),
  close: vi.fn(),
  interrupt: vi.fn(),
  initializationResult: vi.fn(),
  [Symbol.asyncIterator]: vi.fn(),
};

const SONNET_ROW = {
  value: "sonnet",
  resolvedModel: "glm-5.3-flashx[1m]",
  displayName: "sonnet",
  description: "d",
};

function leftovers(): string[] {
  return readdirSync(dir);
}

function lastOptions(): Record<string, unknown> {
  const call: unknown = queryMock.mock.calls.at(-1)?.[0];
  if (typeof call !== "object" || call === null || !("options" in call)) {
    throw new Error("Expected a query call");
  }
  return { ...(call.options as Record<string, unknown>) };
}

function sessionOptions(
  tokenFlagSettingsDir: string | undefined,
  sandboxEnabled = false,
): SdkSessionOptions {
  return buildSessionOptions(
    {
      cwd: "/tmp/worktree",
      instructionMode: "append",
      permissionMode: "acceptEdits",
      permissionScope: "workspace",
      serviceTier: "default",
      workflowsEnabled: false,
      chromeEnabled: false,
      disable1MContext: false,
      artifactsEnabled: false,
      sandboxEnabled,
    },
    { ANTHROPIC_AUTH_TOKEN: TOKEN },
    tokenFlagSettingsDir === undefined
      ? null
      : { env: PROFILE_ENV, settingsDir: tokenFlagSettingsDir },
  );
}

function sandboxFromFile(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")).sandbox;
}

function holdStreamOpen(): { end: () => void } {
  let end: () => void = () => {};
  mockQueryInstance[Symbol.asyncIterator].mockReturnValue({
    next: vi.fn(
      () =>
        new Promise<IteratorResult<SDKMessage>>((resolve) => {
          end = () => resolve({ value: undefined, done: true });
        }),
    ),
    return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
  });
  return { end: () => end() };
}

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "bb-token-flag-settings-"));
  isolatedHome = mkdtempSync(join(tmpdir(), "bb-token-flag-home-"));
  vi.stubEnv("HOME", isolatedHome);
  queryMock.mockImplementation(() => mockQueryInstance);
  mockQueryInstance.applyFlagSettings.mockResolvedValue(undefined);
  mockQueryInstance.interrupt.mockResolvedValue(undefined);
  mockQueryInstance.initializationResult.mockResolvedValue({
    models: [SONNET_ROW],
  });
  mockQueryInstance[Symbol.asyncIterator].mockReturnValue({
    next: vi.fn().mockResolvedValue({ value: undefined, done: true }),
    return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(isolatedHome, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

describe("writeTokenFlagSettingsFile", () => {
  it("creates a unique 0600 file holding the settings and the token", () => {
    const first = writeTokenFlagSettingsFile({
      dir,
      settings: { env: PROFILE_ENV, apiKeyHelper: "" },
      token: TOKEN,
    });
    const second = writeTokenFlagSettingsFile({
      dir,
      settings: {},
      token: TOKEN,
    });

    expect(first).not.toBe(second);
    expect(statSync(first).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(first, "utf8"))).toEqual({
      env: { ...PROFILE_ENV, ANTHROPIC_AUTH_TOKEN: TOKEN },
      apiKeyHelper: "",
    });
  });

  it("refuses a directory open to group or others", () => {
    chmodSync(dir, 0o755);

    expect(() =>
      writeTokenFlagSettingsFile({ dir, settings: {}, token: TOKEN }),
    ).toThrow(/no group or other permissions/u);
    expect(leftovers()).toEqual([]);
  });
});

describe("SdkSession with a token profile", () => {
  it("passes a 0600 settings file path, never the token, in the query options", () => {
    holdStreamOpen();
    const session = new SdkSession(sessionOptions(dir), vi.fn(), vi.fn());

    session.start();

    const options = lastOptions();
    expect(typeof options.settings).toBe("string");
    const file = options.settings as string;
    expect(file.startsWith(`${dir}/`)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o077).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      apiKeyHelper: "",
      autoMemoryEnabled: true,
      env: { ...PROFILE_ENV, ANTHROPIC_AUTH_TOKEN: TOKEN },
    });
    expect(
      JSON.stringify({
        ...options,
        env: undefined,
        abortController: undefined,
      }),
    ).not.toContain(TOKEN);
    session.stop();
  });

  it("writes the sandbox into the settings file and passes no sandbox option", () => {
    holdStreamOpen();
    const options = sessionOptions(dir, true);
    const session = new SdkSession(options, vi.fn(), vi.fn());

    session.start();

    const query = lastOptions();
    expect(typeof query.settings).toBe("string");
    expect(query).not.toHaveProperty("sandbox");
    const file = query.settings as string;
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written.sandbox).toEqual(options.sandbox);
    expect(written.sandbox.failIfUnavailable).toBe(false);
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
    session.stop();
  });

  it("writes no sandbox key when the token session has no sandbox", () => {
    holdStreamOpen();
    const session = new SdkSession(sessionOptions(dir), vi.fn(), vi.fn());

    session.start();

    const query = lastOptions();
    expect(query).not.toHaveProperty("sandbox");
    expect(
      JSON.parse(readFileSync(query.settings as string, "utf8")),
    ).not.toHaveProperty("sandbox");
    session.stop();
  });

  it("keeps the sandbox option for a session without a token profile", () => {
    holdStreamOpen();
    const options = sessionOptions(undefined, true);
    const session = new SdkSession(options, vi.fn(), vi.fn());

    session.start();

    const query = lastOptions();
    expect(query.sandbox).toEqual(options.sandbox);
    expect(typeof query.settings).toBe("object");
    expect(leftovers()).toEqual([]);
    session.stop();
  });

  it("writes failIfUnavailable true when an enabled sandbox leaves it unset", () => {
    holdStreamOpen();
    const options = sessionOptions(dir);
    options.sandbox = { enabled: true };
    const session = new SdkSession(options, vi.fn(), vi.fn());

    session.start();

    expect(sandboxFromFile(lastOptions().settings as string)).toEqual({
      enabled: true,
      failIfUnavailable: true,
    });
    session.stop();
  });

  it("writes the current sandbox, or none, into a fresh file on restart", () => {
    holdStreamOpen();
    const options = sessionOptions(dir, true);
    const session = new SdkSession(options, vi.fn(), vi.fn());
    session.start();
    const firstFile = lastOptions().settings as string;
    expect(sandboxFromFile(firstFile)).toEqual(options.sandbox);
    session.stop();

    options.sandbox = {
      enabled: true,
      failIfUnavailable: false,
      filesystem: { allowWrite: ["/tmp/extra"] },
    };
    session.start();
    const secondFile = lastOptions().settings as string;
    expect(secondFile).not.toBe(firstFile);
    expect(sandboxFromFile(secondFile)).toEqual(options.sandbox);
    expect(lastOptions()).not.toHaveProperty("sandbox");
    session.stop();

    options.sandbox = undefined;
    session.start();
    const thirdFile = lastOptions().settings as string;
    expect(JSON.parse(readFileSync(thirdFile, "utf8"))).not.toHaveProperty(
      "sandbox",
    );
    expect(lastOptions()).not.toHaveProperty("sandbox");
    session.stop();
  });

  it("removes the file on stop", () => {
    holdStreamOpen();
    const session = new SdkSession(sessionOptions(dir), vi.fn(), vi.fn());
    session.start();
    expect(leftovers()).toHaveLength(1);

    session.stop();

    expect(leftovers()).toEqual([]);
  });

  it("removes the file when the stream ends and on a graceful close", async () => {
    const stream = holdStreamOpen();
    const ended = new SdkSession(sessionOptions(dir), vi.fn(), vi.fn());
    ended.start();
    expect(leftovers()).toHaveLength(1);
    stream.end();
    await vi.waitFor(() => expect(leftovers()).toEqual([]));

    const closing = holdStreamOpen();
    const graceful = new SdkSession(sessionOptions(dir), vi.fn(), vi.fn());
    graceful.start();
    expect(leftovers()).toHaveLength(1);
    mockQueryInstance.interrupt.mockImplementation(async () => closing.end());
    await graceful.closeGracefully(1_000);
    await vi.waitFor(() => expect(leftovers()).toEqual([]));
  });

  it("writes a fresh file with the current token for each new session", () => {
    holdStreamOpen();
    const first = new SdkSession(sessionOptions(dir), vi.fn(), vi.fn());
    first.start();
    const firstFile = lastOptions().settings as string;
    first.stop();

    const rotated = sessionOptions(dir);
    rotated.env = { ...rotated.env, ANTHROPIC_AUTH_TOKEN: "rotated-token" };
    const second = new SdkSession(rotated, vi.fn(), vi.fn());
    second.start();
    const secondFile = lastOptions().settings as string;

    expect(secondFile).not.toBe(firstFile);
    expect(
      JSON.parse(readFileSync(secondFile, "utf8")).env.ANTHROPIC_AUTH_TOKEN,
    ).toBe("rotated-token");
    second.stop();
  });

  it("removes the file when the query cannot be created", () => {
    queryMock.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });
    const session = new SdkSession(sessionOptions(dir), vi.fn(), vi.fn());

    expect(() => session.start()).toThrow("spawn failed");

    expect(leftovers()).toEqual([]);
  });

  it("fails before spawning when the session env has no token", () => {
    const options = sessionOptions(dir);
    options.env = {};
    const session = new SdkSession(options, vi.fn(), vi.fn());

    expect(() => session.start()).toThrow(/no ANTHROPIC_AUTH_TOKEN/u);
    expect(queryMock).not.toHaveBeenCalled();
    expect(leftovers()).toEqual([]);
  });

  it("keeps the settings object and writes no file for default and login profiles", () => {
    holdStreamOpen();
    const options = sessionOptions(undefined);
    expect(options).not.toHaveProperty("tokenFlagSettingsDir");
    const session = new SdkSession(options, vi.fn(), vi.fn());

    session.start();

    expect(lastOptions().settings).toEqual({
      autoMemoryEnabled: true,
      enableWorkflows: false,
      ultracode: false,
      fastMode: false,
    });
    expect(leftovers()).toEqual([]);
    session.stop();
  });
});

describe("model probe with a token profile", () => {
  const probeEnv = {
    ANTHROPIC_AUTH_TOKEN: TOKEN,
    ANTHROPIC_BASE_URL: PROFILE_ENV.ANTHROPIC_BASE_URL,
  };

  it("hands the CLI a 0600 settings file path and removes it after success", async () => {
    let seenFile = "";
    let seenMode = 0;
    let seenContent = "";
    mockQueryInstance.initializationResult.mockImplementation(async () => {
      seenFile = lastOptions().settings as string;
      seenMode = statSync(seenFile).mode & 0o777;
      seenContent = readFileSync(seenFile, "utf8");
      return { models: [SONNET_ROW] };
    });

    await listClaudeCodeBridgeModels(probeEnv, {
      env: PROFILE_ENV,
      settingsDir: dir,
    });

    expect(seenFile.startsWith(`${dir}/`)).toBe(true);
    expect(seenMode).toBe(0o600);
    expect(JSON.parse(seenContent).env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
    expect(JSON.stringify(lastOptions().settings)).not.toContain(TOKEN);
    expect(existsSync(seenFile)).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(mockQueryInstance.close).toHaveBeenCalledOnce();
  });

  it("removes the file when the probe fails", async () => {
    mockQueryInstance.initializationResult.mockRejectedValue(
      new Error("probe failed"),
    );

    await expect(
      listClaudeCodeBridgeModels(probeEnv, {
        env: PROFILE_ENV,
        settingsDir: dir,
      }),
    ).rejects.toThrow("probe failed");

    expect(leftovers()).toEqual([]);
  });

  it("removes the file when the query cannot be created", async () => {
    queryMock.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });

    await expect(
      listClaudeCodeBridgeModels(probeEnv, {
        env: PROFILE_ENV,
        settingsDir: dir,
      }),
    ).rejects.toThrow("spawn failed");

    expect(leftovers()).toEqual([]);
  });

  it("passes no settings and writes no file for a default or login probe", async () => {
    await listClaudeCodeBridgeModels({});

    expect(lastOptions()).not.toHaveProperty("settings");
    expect(leftovers()).toEqual([]);
  });

  it("does not retry without ANTHROPIC_MODEL for a token profile", async () => {
    mockQueryInstance.initializationResult.mockRejectedValue(
      new Error(
        "--client-data-url: covers other models, pass the matching --model",
      ),
    );

    await expect(
      listClaudeCodeBridgeModels(
        { ...probeEnv, ANTHROPIC_MODEL: "glm-5.3" },
        { env: PROFILE_ENV, settingsDir: dir },
      ),
    ).rejects.toThrow("pass the matching --model");

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(leftovers()).toEqual([]);
  });
});
