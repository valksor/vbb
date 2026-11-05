import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";

const { forkSessionMock, queryMock } = vi.hoisted(() => ({
  forkSessionMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
  forkSession: forkSessionMock,
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

const PROFILE_DIR = join(homedir(), ".claude-bridge-profile-test");
const OTHER_DIR = join(homedir(), ".claude-bridge-other-test");
const CREDENTIAL_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
] as const;

let savedEnv: NodeJS.ProcessEnv;

function createIdleQuery() {
  return {
    initializationResult: vi.fn().mockResolvedValue({
      account: {},
      models: [{ value: "default", displayName: "Default", description: "d" }],
    }),
    applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    getContextUsage: vi.fn().mockResolvedValue(null),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<never>>(() => {}),
        return: async () => ({ value: undefined, done: true as const }),
      };
    },
  };
}

function lastQueryEnv(): Record<string, string | undefined> {
  const call: unknown = queryMock.mock.calls.at(-1)?.[0];
  if (
    typeof call !== "object" ||
    call === null ||
    !("options" in call) ||
    typeof call.options !== "object" ||
    call.options === null ||
    !("env" in call.options) ||
    typeof call.options.env !== "object" ||
    call.options.env === null
  ) {
    throw new Error("Expected Claude SDK query options with env");
  }
  return { ...call.options.env };
}

function options(
  providerOptions: Record<string, JsonValue> | undefined,
  envVars?: Record<string, string>,
): Record<string, JsonValue> {
  return {
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: "ask",
    instructions: "test",
    ...(envVars ? { envVars } : {}),
    providerOptions: { workflowsEnabled: false, ...providerOptions },
  };
}

function turnParams(
  threadId: string,
  providerOptions: Record<string, JsonValue> | undefined,
): Record<string, JsonValue> {
  return {
    threadId,
    providerThreadId: threadId,
    clientRequestId: "creq_abcdefghjk",
    input: [{ type: "text", text: "hi" }],
    options: options(providerOptions),
  };
}

async function loadBridge() {
  vi.resetModules();
  const { handleLine } = await import("../bridge.js");
  return createBridgeJsonRpcTestHarness(handleLine);
}

describe("bridge profile adoption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedEnv = { ...process.env };
    for (const key of CREDENTIAL_KEYS) process.env[key] = `ambient-${key}`;
    process.env.CLAUDE_CONFIG_DIR = "/ambient/config";
    queryMock.mockImplementation(
      ({ prompt }: { prompt?: AsyncIterable<unknown> }) => {
        if (prompt !== undefined) {
          void (async () => {
            for await (const message of prompt) void message;
          })();
        }
        return createIdleQuery();
      },
    );
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  });

  it("adopts the dir from a first thread/start carrying only options.providerOptions", async () => {
    const bridge = await loadBridge();
    bridge.sendRequest(1, "thread/start", {
      cwd: "/tmp/worktree",
      instructionMode: "append",
      options: options({ claudeConfigDir: PROFILE_DIR }),
      threadId: "t1",
    });
    expect((await bridge.waitForResponse(1)).error).toBeUndefined();
    bridge.sendRequest(2, "turn/start", turnParams("t1", undefined));
    await bridge.waitForResponse(2);

    const env = lastQueryEnv();
    expect(env.CLAUDE_CONFIG_DIR).toBe(PROFILE_DIR);
    for (const key of CREDENTIAL_KEYS) expect(env[key]).toBeUndefined();
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(PROFILE_DIR);
    for (const key of CREDENTIAL_KEYS) expect(process.env[key]).toBeUndefined();
  });

  it("adopts the dir from a first model/list", async () => {
    const bridge = await loadBridge();
    bridge.sendRequest(1, "model/list", {
      providerOptions: { claudeConfigDir: PROFILE_DIR },
    });
    expect((await bridge.waitForResponse(1)).error).toBeUndefined();

    const env = lastQueryEnv();
    expect(env.CLAUDE_CONFIG_DIR).toBe(PROFILE_DIR);
    for (const key of CREDENTIAL_KEYS) expect(env[key]).toBeUndefined();
  });

  it("adopts the dir from provider/health params.providerOptions", async () => {
    process.env.BB_CLAUDE_CODE_EXECUTABLE = "/nonexistent/claude";
    const bridge = await loadBridge();
    bridge.sendRequest(1, "provider/health", {
      providerId: "claude-code-work",
      providerOptions: { claudeConfigDir: PROFILE_DIR },
    });
    const response = await bridge.waitForResponse(1);

    expect(response.result).toMatchObject({
      health: {
        loginCommand: `CLAUDE_CONFIG_DIR='${PROFILE_DIR}' claude auth login`,
      },
    });
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(PROFILE_DIR);
  });

  it("strips credentials supplied through config.envVars", async () => {
    const bridge = await loadBridge();
    bridge.sendRequest(1, "thread/start", {
      cwd: "/tmp/worktree",
      instructionMode: "append",
      options: options(
        { claudeConfigDir: PROFILE_DIR },
        {
          CLAUDE_CODE_OAUTH_TOKEN: "shell-token",
          ANTHROPIC_API_KEY: "shell-key",
          CLAUDE_CONFIG_DIR: "/override/attempt",
          ANTHROPIC_MODEL: "claude-opus-test",
        },
      ),
      threadId: "t1",
    });
    await bridge.waitForResponse(1);
    bridge.sendRequest(2, "turn/start", {
      ...turnParams("t1", undefined),
      options: options(
        { claudeConfigDir: PROFILE_DIR },
        {
          CLAUDE_CODE_OAUTH_TOKEN: "shell-token",
          ANTHROPIC_API_KEY: "shell-key",
          ANTHROPIC_MODEL: "claude-opus-test",
        },
      ),
    });
    await bridge.waitForResponse(2);

    const env = lastQueryEnv();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe(PROFILE_DIR);
    expect(env.ANTHROPIC_MODEL).toBe("claude-opus-test");
  });

  it("fails a later request with a different dir and keeps the first", async () => {
    const bridge = await loadBridge();
    bridge.sendRequest(1, "thread/start", {
      cwd: "/tmp/worktree",
      instructionMode: "append",
      options: options({ claudeConfigDir: PROFILE_DIR }),
      threadId: "t1",
    });
    await bridge.waitForResponse(1);
    bridge.sendRequest(
      2,
      "turn/start",
      turnParams("t1", { claudeConfigDir: OTHER_DIR }),
    );
    const response = await bridge.waitForResponse(2);

    expect(response.error?.message).toContain("cannot switch");
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(PROFILE_DIR);
  });

  it("rejects an invalid dir on the first request without touching env", async () => {
    const bridge = await loadBridge();
    bridge.sendRequest(1, "model/list", {
      providerOptions: { claudeConfigDir: "relative/dir" },
    });
    const response = await bridge.waitForResponse(1);

    expect(response.error?.message).toContain("absolute");
    expect(process.env.CLAUDE_CONFIG_DIR).toBe("/ambient/config");
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(
      "ambient-CLAUDE_CODE_OAUTH_TOKEN",
    );
  });

  it("leaves the default provider env untouched when the option is absent", async () => {
    const bridge = await loadBridge();
    bridge.sendRequest(1, "thread/start", {
      cwd: "/tmp/worktree",
      instructionMode: "append",
      options: options(undefined, { CLAUDE_CODE_OAUTH_TOKEN: "shell-token" }),
      threadId: "t1",
    });
    await bridge.waitForResponse(1);
    bridge.sendRequest(2, "turn/start", turnParams("t1", undefined));
    await bridge.waitForResponse(2);

    const env = lastQueryEnv();
    expect(env.CLAUDE_CONFIG_DIR).toBe("/ambient/config");
    expect(env.ANTHROPIC_API_KEY).toBe("ambient-ANTHROPIC_API_KEY");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("shell-token");
    expect(process.env.ANTHROPIC_API_KEY).toBe("ambient-ANTHROPIC_API_KEY");
  });
});
